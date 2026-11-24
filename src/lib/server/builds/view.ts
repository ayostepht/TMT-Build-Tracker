import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { tickLoggedPieces } from '#lib/domain/actions.ts';
import { filterSteps } from '#lib/domain/assembly.ts';
import { CUSTOM_SECTION, isCustomSource } from '#lib/domain/custom.ts';
import { linkedRunGrams } from '#lib/domain/accounting.ts';
import { isPreLinkRun, readSpoolmanStock, type SpoolmanCacheData } from '#lib/domain/spoolman.ts';
import { buildStarted, type LiveJobs } from '#lib/domain/started.ts';
import { inactiveSlugs, resolveChoices, variantOfPart } from '#lib/domain/variants.ts';
import type {
	ActivityItem,
	BuildAssembly,
	BuildPhoto,
	HandoffRecord,
	PhotoKind,
	BuildPhase,
	BuildPrinter,
	BuildView,
	CustomPiece,
	PartDef,
	PartPatch,
	PartState,
	PartStatus,
	PartPlacement,
	Plate,
	PrintRun,
	RunResult,
	SkippedPart,
	TemplateModelInfo
} from '#lib/domain/types.ts';
import { materialFamily } from '#lib/filament-catalog.ts';
import type { PlateTimeEstimate } from '#lib/domain/time-estimate.ts';
import { buildAccess } from '../access';
import { hardwareModelUrl } from '../models/hardware';
import type { Db } from '../db';
import { estimateArrangedPlates, loadTimeModel } from './time-model';
import { loadProfileRows, resolveProfiles } from './part-profiles';
import {
	activity,
	buildAssembly,
	buildCustomPieces,
	buildFilaments,
	buildHandoff,
	buildPhotos,
	buildParts,
	buildPlates,
	builds,
	member,
	spoolmanCache,
	printRuns,
	printerJobs,
	templateAssemblySteps,
	templateFilamentRoles,
	templateGuidePages,
	templateHardware,
	templateModels,
	templatePartPlacements,
	templateParts,
	templatePlateLayouts,
	templatePlates,
	templates,
	user
} from '../db/schema';
import { normalizeRole } from '../access';
import { fromCacheData } from '../spoolman/client';
import { getDeductions, getOrgSettings, ledgerRole, prelinkLedgerKey } from '../org-settings';
import { layoutBed } from '#lib/printers/layout-bed.ts';

function defaultLayoutKey(db: Db, templateId: string): string | null {
	return (
		db
			.select({ key: templatePlateLayouts.key })
			.from(templatePlateLayouts)
			.where(
				and(
					eq(templatePlateLayouts.templateId, templateId),
					eq(templatePlateLayouts.isDefault, true)
				)
			)
			.get()?.key ?? null
	);
}

/** Printer jobs linked to the build that are running right now (printing or paused). */
export function loadLiveJobs(db: Db, buildId: string): LiveJobs {
	const rows = db
		.select({ plateNumber: printerJobs.plateNumber, partSlugs: printerJobs.partSlugs })
		.from(printerJobs)
		.where(
			and(eq(printerJobs.buildId, buildId), inArray(printerJobs.status, ['printing', 'paused']))
		)
		.all();
	return {
		count: rows.length,
		slugs: rows.flatMap((r) => r.partSlugs ?? []),
		plates: rows.map((r) => r.plateNumber).filter((n): n is number => n != null)
	};
}

/**
 * Ids of the given builds that have started printing, in a handful of batched queries (no
 * `loadBuildView` per build). Same definition as `buildStarted`: a logged run, a part that is not
 * "To print" (parts of inactive variants are ignored), or a live (printing / paused) linked job.
 * Drafts are never started.
 */
export function startedBuildIds(db: Db, buildIds: string[]): Set<string> {
	const started = new Set<string>();
	if (!buildIds.length) return started;
	const rows = db
		.select({
			id: builds.id,
			kind: builds.kind,
			templateId: builds.templateId,
			choices: builds.variantChoices
		})
		.from(builds)
		.where(inArray(builds.id, buildIds))
		.all()
		.filter((r) => r.kind !== 'draft');
	if (!rows.length) return started;
	const ids = rows.map((r) => r.id);
	for (const r of db
		.selectDistinct({ id: printRuns.buildId })
		.from(printRuns)
		.where(inArray(printRuns.buildId, ids))
		.all())
		started.add(r.id);
	for (const r of db
		.selectDistinct({ id: printerJobs.buildId })
		.from(printerJobs)
		.where(
			and(inArray(printerJobs.buildId, ids), inArray(printerJobs.status, ['printing', 'paused']))
		)
		.all())
		if (r.id) started.add(r.id);

	const groupsByTemplate = new Map(
		db
			.select({ id: templates.id, groups: templates.variantGroups })
			.from(templates)
			.where(inArray(templates.id, [...new Set(rows.map((r) => r.templateId))]))
			.all()
			.map((t) => [t.id, t.groups ?? []])
	);
	const inactiveByBuild = new Map<string, Set<string>>();
	for (const r of rows) {
		const groups = groupsByTemplate.get(r.templateId) ?? [];
		inactiveByBuild.set(r.id, inactiveSlugs(groups, resolveChoices(groups, r.choices)));
	}
	for (const r of db
		.select({ id: buildParts.buildId, slug: buildParts.partSlug })
		.from(buildParts)
		.where(
			and(
				inArray(buildParts.buildId, ids),
				ne(buildParts.status, 'To print'),
				eq(buildParts.skipped, false)
			)
		)
		.all())
		if (!inactiveByBuild.get(r.id)?.has(r.slug)) started.add(r.id);
	return started;
}

/**
 * Fill `view.spoolman` and every slot's `spoolman` summary (issue #59): link, kept-by mode,
 * sharing count, cached stock and the ledger grams. Reads only; never talks to Spoolman.
 */
function attachSpoolman(db: Db, view: BuildView, orgId: string): void {
	const cfg = getOrgSettings(db, orgId);
	view.spoolman = { configured: !!cfg.spoolmanUrl, keptBy: cfg.spoolmanKeptBy };
	const links = new Map(
		db
			.select()
			.from(buildFilaments)
			.where(eq(buildFilaments.buildId, view.build.id))
			.all()
			.map((f) => [f.roleKey, f])
	);
	const filamentIds = [
		...new Set(
			[...links.values()].flatMap((f) =>
				f.spoolmanFilamentId != null ? [f.spoolmanFilamentId] : []
			)
		)
	];
	const cache = new Map(
		filamentIds.length
			? db
					.select()
					.from(spoolmanCache)
					.where(
						and(
							eq(spoolmanCache.organizationId, orgId),
							inArray(spoolmanCache.spoolmanFilamentId, filamentIds)
						)
					)
					.all()
					.map((c) => [c.spoolmanFilamentId, c])
			: []
	);
	// Other (non-draft) builds of the workspace on the same Spoolman filament, per filament id.
	const shared = new Map<number, Set<string>>();
	if (filamentIds.length)
		for (const r of db
			.select({ fid: buildFilaments.spoolmanFilamentId, build: buildFilaments.buildId })
			.from(buildFilaments)
			.innerJoin(builds, eq(builds.id, buildFilaments.buildId))
			.where(
				and(
					eq(builds.organizationId, orgId),
					ne(builds.kind, 'draft'),
					ne(buildFilaments.buildId, view.build.id),
					inArray(buildFilaments.spoolmanFilamentId, filamentIds)
				)
			)
			.all()) {
			if (r.fid == null) continue;
			const set = shared.get(r.fid) ?? new Set<string>();
			set.add(r.build);
			shared.set(r.fid, set);
		}
	const ledger = getDeductions(db, orgId);
	const runIds = new Set(view.runs.map((r) => r.id));
	const runById = new Map(view.runs.map((r) => [r.id, r]));
	// Which slot an old role-less ledger entry [spoolId, g] belongs to: the one whose own spool it
	// is, else the one whose linked filament holds that spool; null when none or several do.
	const slotSpools = view.filaments.map((f) => {
		const fid = links.get(f.key)?.spoolmanFilamentId;
		const c = fid != null ? cache.get(fid) : undefined;
		return {
			key: f.key,
			own: f.spoolmanSpoolId,
			spools: new Set(
				((c?.data as SpoolmanCacheData | null)?.spools ?? []).flatMap((x) => (x ? [x.id] : []))
			)
		};
	});
	const legacyOwner = (spoolId: number): string | null => {
		const own = slotSpools.filter((x) => x.own === spoolId);
		const hit = own.length ? own : slotSpools.filter((x) => x.spools.has(spoolId));
		return hit.length === 1 ? hit[0].key : null;
	};
	for (const f of view.filaments) {
		const l = links.get(f.key);
		const filamentId = l?.spoolmanFilamentId ?? null;
		const linkedAt = l?.spoolmanLinkedAt ? l.spoolmanLinkedAt.getTime() : null;
		const c = filamentId != null ? cache.get(filamentId) : undefined;
		const cached = c ? fromCacheData(c.data) : null;
		let deductedG = 0;
		for (const [key, entries] of Object.entries(ledger)) {
			if (!runIds.has(key)) continue;
			for (const e of entries) {
				const role = ledgerRole(e);
				if (role !== null) {
					if (role === f.key) deductedG += e[1];
					continue;
				}
				// Old two-element entry [spoolId, g]: the role was not stored. It is this slot's when
				// the spool is this slot's own spool or one of its linked filament's spools, and no
				// other slot claims the same spool. A pre-link run's entry was never part of the
				// post-link grams, so it is not counted against them.
				if (isPreLinkRun(runById.get(key)!, linkedAt)) continue;
				if (legacyOwner(e[0]) === f.key) deductedG += e[1];
			}
		}
		const prelink = (ledger[prelinkLedgerKey(view.build.id, f.key)] ?? []).reduce(
			(a, e) => a + e[1],
			0
		);
		const spool =
			f.spoolmanSpoolId != null
				? cached?.spools.find((x) => x.id === f.spoolmanSpoolId)
				: undefined;
		f.spoolman = {
			filamentId,
			filamentName: cached ? `${cached.vendor ? `${cached.vendor} ` : ''}${cached.name}` : null,
			spoolName: spool?.location ?? null,
			spoolId: f.spoolmanSpoolId,
			linkedAt,
			keptBy: cfg.spoolmanKeptBy,
			sharedWith: filamentId != null ? (shared.get(filamentId)?.size ?? 0) : 0,
			stock: c
				? readSpoolmanStock(
						c.data,
						{ fetchedAt: c.fetchedAt.getTime(), error: c.error },
						f.spoolmanSpoolId
					)
				: null,
			deductedG: Math.round(deductedG * 10) / 10,
			prelinkDeductedG: Math.round(prelink * 10) / 10,
			preLinkLoggedG:
				linkedAt != null && filamentId != null ? linkedRunGrams(view, f.key, linkedAt).preG : 0
		};
	}
}

export function loadBuildView(db: Db, buildId: string, userId: string): BuildView | null {
	const access = buildAccess(db, buildId, userId);
	if (!access) return null;
	const b = db.select().from(builds).where(eq(builds.id, buildId)).get();
	if (!b) return null;
	const tpl = db.select().from(templates).where(eq(templates.id, b.templateId)).get();
	if (!tpl) return null;

	const design = (b.design ?? null) as {
		partRoles?: Record<string, string>;
		lockedParts?: unknown;
	} | null;
	const partRoles = design?.partRoles ?? {};
	// Optional string[]; anything else means nothing is locked. Unknown slugs are ignored below.
	const lockedSlugs = new Set(
		Array.isArray(design?.lockedParts)
			? (design.lockedParts as unknown[]).filter((x): x is string => typeof x === 'string')
			: []
	);

	const tRoles = new Map(
		db
			.select()
			.from(templateFilamentRoles)
			.where(eq(templateFilamentRoles.templateId, tpl.id))
			.all()
			.map((r) => [r.key, r])
	);
	const filaments = db
		.select()
		.from(buildFilaments)
		.where(eq(buildFilaments.buildId, buildId))
		.all()
		.map((f) => {
			const t = tRoles.get(f.roleKey);
			return {
				key: f.roleKey,
				name: f.name,
				material: f.material,
				hex: f.hex,
				tpu: t?.tpu ?? materialFamily(f.material) === 'tpu',
				spools: f.spools,
				spoolAdds: (f.spoolAdds ?? []).map((a) => ({
					id: a.id,
					kg: a.kg,
					at: a.at,
					userId: a.userId,
					userName: null as string | null,
					...(a.note ? { note: a.note } : {}),
					...(a.spoolmanSpoolId != null ? { spoolmanSpoolId: a.spoolmanSpoolId } : {})
				})),
				recommendedSpools: t?.recommendedSpools ?? 1,
				spoolmanSpoolId: f.spoolmanSpoolId,
				kit: !!t
			};
		});
	// Who added each spool.
	const adderIds = [
		...new Set(filaments.flatMap((f) => f.spoolAdds.map((a) => a.userId)).filter((x) => !!x))
	] as string[];
	if (adderIds.length) {
		const names = new Map(
			db
				.select({ id: user.id, name: user.name })
				.from(user)
				.where(inArray(user.id, adderIds))
				.all()
				.map((u) => [u.id, u.name])
		);
		for (const f of filaments)
			for (const a of f.spoolAdds) a.userName = (a.userId && names.get(a.userId)) || null;
	}
	// keep template role order
	const order = [...tRoles.keys()];
	// Colors added in the Design tab come after the template's own slots.
	const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
	filaments.sort((a, c) => rank(a.key) - rank(c.key));

	const variantGroups = tpl.variantGroups ?? [];
	const variantChoices = resolveChoices(variantGroups, b.variantChoices);
	const variantInactive = inactiveSlugs(variantGroups, variantChoices);
	const variantOf = variantOfPart(variantGroups);

	const allParts: PartDef[] = db
		.select()
		.from(templateParts)
		.where(eq(templateParts.templateId, tpl.id))
		.orderBy(asc(templateParts.sort))
		.all()
		.map((p) => ({
			slug: p.slug,
			name: p.name,
			section: p.section,
			role: partRoles[p.slug] ?? p.defaultRole,
			defaultRole: p.defaultRole,
			locked: lockedSlugs.has(p.slug),
			bomGrams: p.bomGrams,
			qty: p.qty,
			walls: p.walls,
			infill: p.infill,
			supports: p.supports,
			brim: p.brim,
			sourceFile: p.sourceFile,
			notes: p.notes,
			components: p.components,
			allowedMaterials: p.allowedMaterials,
			symmetryGroup: p.symmetryGroup,
			variantGroup: variantOf.get(p.slug)?.group ?? null,
			variantOption: variantOf.get(p.slug)?.option ?? null,
			guideRefs: p.guideRefs,
			sort: p.sort
		}));
	// Custom pieces (uploaded accessories / beta replacements): their parts join `parts` after the kit
	// parts (never `allParts`, which drives designs), and their plates are build_plates rows.
	const pieceRows = db
		.select()
		.from(buildCustomPieces)
		.where(eq(buildCustomPieces.buildId, buildId))
		.orderBy(asc(buildCustomPieces.createdAt), asc(buildCustomPieces.id))
		.all();
	const customParts: PartDef[] = pieceRows.flatMap((piece, pi) =>
		(piece.parts ?? []).map((cp, i) => ({
			slug: cp.slug,
			name: cp.name,
			section: CUSTOM_SECTION,
			role: cp.role,
			defaultRole: cp.role,
			locked: false,
			bomGrams: null,
			qty: 1,
			walls: null,
			infill: '',
			supports: '',
			brim: null,
			sourceFile: piece.fileName ?? '',
			notes: [],
			components: [],
			allowedMaterials: [],
			symmetryGroup: null,
			variantGroup: null,
			variantOption: null,
			guideRefs: [],
			sort: 100000 + pi * 1000 + i,
			custom: { pieceId: piece.id }
		}))
	);
	const partRows = db.select().from(buildParts).where(eq(buildParts.buildId, buildId)).all();
	// "Not printing": hidden like an inactive variant option, but restorable and listed in `skipped`.
	const skippedSlugs = new Set(
		partRows.filter((r) => r.skipped && !variantInactive.has(r.partSlug)).map((r) => r.partSlug)
	);
	const inactive = new Set([...variantInactive, ...skippedSlugs]);
	const parts = [
		...allParts.filter((p) => !inactive.has(p.slug)),
		...customParts.filter((p) => !inactive.has(p.slug))
	];

	const state: Record<string, PartState> = {};
	for (const s of partRows) {
		if (inactive.has(s.partSlug)) continue;
		state[s.partSlug] = {
			slug: s.partSlug,
			status: s.status as PartStatus,
			startedAt: s.startedAt ? s.startedAt.toISOString() : null,
			printedOn: s.printedOn,
			runEstSeconds: s.runEstSeconds,
			comps: s.comps,
			printingComps: s.printingComps?.length ? s.printingComps : null,
			assigneeUserId: s.assigneeUserId,
			manualGrams: s.manualGrams,
			updatedAt: s.updatedAt.toISOString()
		};
	}
	// Builds from before a part existed may lack a row until the next startup backfill.
	for (const p of parts) {
		state[p.slug] ??= {
			slug: p.slug,
			status: 'To print',
			startedAt: null,
			printedOn: null,
			runEstSeconds: null,
			comps: {},
			printingComps: null,
			assigneeUserId: null,
			manualGrams: null,
			updatedAt: b.createdAt.toISOString()
		};
	}

	const runNotes = new Map(
		db
			.select({ number: templatePlates.number, runNote: templatePlates.runNote })
			.from(templatePlates)
			.where(eq(templatePlates.templateId, tpl.id))
			.all()
			.map((p) => [p.number, p.runNote])
	);
	// Plates copied from a built-in layout take their run note from that layout.
	const layoutNotes = new Map<string, Map<number, string | null>>();
	for (const l of db
		.select()
		.from(templatePlateLayouts)
		.where(eq(templatePlateLayouts.templateId, tpl.id))
		.all())
		layoutNotes.set(l.key, new Map(l.plates.map((p) => [p.number, p.runNote ?? null])));
	const noteFor = (source: string | null, number: number): string | null => {
		if (isCustomSource(source)) return null;
		if (source?.startsWith('layout:')) return layoutNotes.get(source.slice(7))?.get(number) ?? null;
		if (source?.startsWith('upload:') || source === 'arranged') return null;
		return runNotes.get(number) ?? null;
	};
	const rawPlates = db
		.select()
		.from(buildPlates)
		.where(eq(buildPlates.buildId, buildId))
		.orderBy(asc(buildPlates.number))
		.all();
	// Time precedence: a manual entry (build_plates.manual_est_seconds) > slicer (uploaded sliced 3MF) > MakeGood's profile time > our estimate.
	// Arranged plates carry no time of their own; estimate it from MakeGood's X/P/A times.
	// The build's print template (per-part data learned from a sliced file) comes before MakeGood's numbers.
	const { profiles: partProfiles, template: printTemplate } = resolveProfiles(
		loadProfileRows(db, buildId),
		allParts,
		filaments.map((f) => f.key)
	);
	const learned = new Map(
		Object.entries(partProfiles).map(([slug, pr]) => [
			slug,
			{ secondsPerCopy: pr.secondsPerCopy, gramsByRole: pr.gramsByRole, copies: pr.copies }
		])
	);
	const arrangedRows = rawPlates.filter((p) => p.source === 'arranged');
	// MakeGood layout plates whose every part was learned also take the learned time (not uploaded plates:
	// those are the slicer's own numbers; not per-part-run plates, whose unit is a single part).
	const learnedRows = learned.size
		? rawPlates.filter(
				(p) =>
					p.source !== 'arranged' &&
					!p.source?.startsWith('upload:') &&
					!isCustomSource(p.source) &&
					!p.perPartRuns
			)
		: [];
	const arrangedEst =
		arrangedRows.length || learnedRows.length
			? estimateArrangedPlates(
					loadTimeModel(db, tpl.id, learned),
					[...arrangedRows, ...learnedRows].map((p) => ({
						number: p.number,
						runs: p.runs,
						arrangement: p.arrangement,
						parts: p.parts.filter((s) => !inactive.has(s))
					}))
				)
			: new Map<number, PlateTimeEstimate>();
	const learnedPlate = (p: { number: number; source: string | null }) =>
		p.source !== 'arranged' &&
		arrangedEst.get(p.number)?.learned &&
		learnedRows.some((r) => r.number === p.number);
	// Time before a manual entry overrides it.
	const baseTime = (p: (typeof rawPlates)[number]) =>
		({
			...(p.source === 'arranged' || learnedPlate(p)
				? {
						estSeconds: arrangedEst.get(p.number)?.estSeconds ?? null,
						estSource: arrangedEst.get(p.number)?.estSeconds
							? arrangedEst.get(p.number)?.learned
								? ('learned' as const)
								: ('estimate' as const)
							: null,
						estRough: !!arrangedEst.get(p.number)?.rough
					}
				: {
						estSeconds: p.estSeconds,
						estSource: p.estSeconds
							? p.source?.startsWith('upload:') || isCustomSource(p.source)
								? ('slicer' as const)
								: ('profile' as const)
							: null,
						estRough: false
					})
		}) as {
			estSeconds: number | null;
			estSource: 'slicer' | 'learned' | 'profile' | 'estimate' | null;
			estRough: boolean;
		};
	const plates: Plate[] = rawPlates
		.map((p) => ({
			number: p.number,
			name: p.name,
			...(() => {
				const base = baseTime(p);
				return p.manualEstSeconds
					? {
							estSeconds: p.manualEstSeconds,
							estSource: 'manual' as const,
							estRough: false,
							baseEstSeconds: base.estSeconds,
							baseEstSource: base.estSource
						}
					: base;
			})(),
			runs: p.runs,
			runNote: noteFor(p.source, p.number),
			perPartRuns: p.perPartRuns,
			parts: p.parts,
			slicerGrams: p.slicerGrams,
			slicerByPart: p.slicerByPart,
			gramsSource: gramsSourceOf(p, arrangedEst.get(p.number)?.gramsByRole, !!learnedPlate(p)),
			thumbnailPath: p.thumbnailPath,
			filamentGrams:
				p.source === 'arranged' || learnedPlate(p)
					? (arrangedEst.get(p.number)?.gramsByRole ?? {})
					: (p.filamentGrams ?? {}),
			source: p.source ?? 'template'
		}))
		.map((p) => ({ ...p, parts: p.parts.filter((s) => !inactive.has(s)) }))
		.filter((p) => p.parts.length > 0);

	const runs: PrintRun[] = db
		.select({ r: printRuns, userName: user.name })
		.from(printRuns)
		.leftJoin(user, eq(user.id, printRuns.userId))
		.where(eq(printRuns.buildId, buildId))
		.orderBy(asc(printRuns.date), asc(printRuns.id))
		.all()
		.map(({ r, userName }) => ({
			id: r.id,
			plateNumber: r.plateNumber,
			partSlug: r.partSlug,
			partSlugs: r.partSlugs ?? null,
			comps: r.comps?.length ? r.comps : null,
			date: r.date,
			result: r.result as RunResult,
			grams: r.grams,
			hours: r.hours,
			estSeconds: r.estSeconds,
			printer: r.printer,
			userId: r.userId,
			userName,
			note: r.note,
			createdAt: r.createdAt ? r.createdAt.getTime() : null
		}));

	const acts: ActivityItem[] = db
		.select({ a: activity, userName: user.name })
		.from(activity)
		.leftJoin(user, eq(user.id, activity.userId))
		.where(eq(activity.buildId, buildId))
		.orderBy(desc(activity.at), desc(activity.id))
		.limit(50)
		.all()
		.map(({ a, userName }) => ({
			id: a.id,
			userId: a.userId,
			userName,
			kind: a.kind,
			payload: a.payload,
			at: a.at.toISOString()
		}));

	const members = db
		.select({ userId: member.userId, name: user.name, role: member.role })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(eq(member.organizationId, b.organizationId))
		.all()
		.map((m) => ({ userId: m.userId, name: m.name, role: normalizeRole(m.role) }));

	const modelRow = db
		.select()
		.from(templateModels)
		.where(eq(templateModels.templateId, tpl.id))
		.get();
	const model: TemplateModelInfo | null = modelRow
		? {
				url: `/api/templates/${encodeURIComponent(tpl.id)}/model.glb?v=${encodeURIComponent(modelRow.version)}`,
				version: modelRow.version,
				hardwareUrl: hardwareModelUrl(tpl.id),
				placements: db
					.select()
					.from(templatePartPlacements)
					.where(eq(templatePartPlacements.templateId, tpl.id))
					.all()
					.map((r): PartPlacement => ({
						slug: r.slug,
						matrix: r.matrix,
						instances: r.instances,
						placed: r.placed
					})),
				slugs: modelRow.slugs
			}
		: null;

	const kind = b.kind === 'draft' ? 'draft' : 'build';
	// Drafts are never started (buildStarted ignores jobs and runs for them).
	const liveJobs = kind === 'draft' ? undefined : loadLiveJobs(db, buildId);

	const stateOf = (slug: string) => partRows.find((r) => r.partSlug === slug);
	const liveSlugs = new Set(liveJobs?.slugs ?? []);
	const plateOf = (slug: string) => rawPlates.find((pl) => pl.parts.includes(slug));
	const customSlugs = new Set(customParts.map((p) => p.slug));
	const skipped: SkippedPart[] = [...allParts, ...customParts]
		.filter((p) => skippedSlugs.has(p.slug))
		.map((p) => {
			const pl = plateOf(p.slug);
			return {
				slug: p.slug,
				name: p.name,
				role: p.role,
				status: (stateOf(p.slug)?.status ?? 'To print') as PartStatus,
				plateNumber: pl?.number ?? null,
				plateName: pl?.name ?? null,
				custom: customSlugs.has(p.slug)
			};
		});
	const customPieces: CustomPiece[] = pieceRows.map((piece) => {
		const slugs = (piece.parts ?? []).map((cp) => cp.slug);
		const plateNums = rawPlates
			.filter((pl) => pl.source === `custom:${piece.id}`)
			.map((pl) => pl.number);
		const hasRun = runs.some(
			(r) =>
				(r.plateNumber != null && plateNums.includes(r.plateNumber)) ||
				(r.partSlug != null && slugs.includes(r.partSlug)) ||
				(r.partSlugs ?? []).some((s) => slugs.includes(s))
		);
		const busy =
			slugs.some((s) => stateOf(s)?.status === 'Printing' || liveSlugs.has(s)) ||
			plateNums.some((n) => liveJobs?.plates.includes(n));
		return {
			id: piece.id,
			name: piece.name,
			fileName: piece.fileName,
			sliced: piece.sliced,
			replaces: piece.replaces ?? [],
			parts: slugs,
			plates: plateNums,
			libraryId: piece.libraryId,
			colors: (piece.parts ?? []).map((cp) => {
				const own = rawPlates.find(
					(pl) => pl.source === `custom:${piece.id}` && pl.parts[0] === cp.slug
				);
				const weighed = Object.entries(own?.filamentGrams ?? {})
					.filter(([, g]) => g > 0)
					.map(([role, grams]) => ({ role, grams }));
				return {
					slug: cp.slug,
					name: cp.name,
					roles: weighed.length ? weighed : [{ role: cp.role, grams: null }]
				};
			}),
			removable: !hasRun && !busy
		};
	});
	const result: BuildView = {
		build: {
			id: b.id,
			organizationId: b.organizationId,
			name: b.name,
			recipient: b.recipient,
			hospital: b.hospital,
			kind,
			phase: b.phase as BuildPhase,
			deliveryDate: b.deliveryDate,
			createdAt: b.createdAt.toISOString(),
			templateId: tpl.id,
			templateName: tpl.name,
			templateVersion: tpl.version,
			globalSettings: tpl.globalSettings,
			sections: tpl.sections,
			setupStep: b.setupStep,
			templateOwned: tpl.ownerOrgId !== null
		},
		role: access.role,
		canEdit: access.canEdit,
		filaments,
		parts,
		state: tickLoggedPieces({ runs, parts }, state),
		variantGroups,
		variantChoices,
		allParts,
		model,
		partProfiles,
		printTemplate,
		plates,
		runs,
		guidePages: db
			.select()
			.from(templateGuidePages)
			.where(eq(templateGuidePages.templateId, tpl.id))
			.orderBy(asc(templateGuidePages.sort))
			.all()
			.map((g) => ({ page: g.page, title: g.title, sort: g.sort, hasImage: !!g.imagePath })),
		hardware: db
			.select()
			.from(templateHardware)
			.where(eq(templateHardware.templateId, tpl.id))
			.all()
			.map((h) => ({ name: h.name, qty: h.qty, note: h.note })),
		activity: acts,
		members,
		printer: (b.printer as BuildPrinter | null) ?? null,
		layoutPrinter: b.printer ? null : layoutBed(b.plateLayout ?? defaultLayoutKey(db, tpl.id)),
		assembly: loadAssembly(
			db,
			buildId,
			tpl.id,
			variantChoices,
			new Set(allParts.filter((p) => !variantInactive.has(p.slug)).map((p) => p.slug)),
			skippedSlugs
		),
		photos: loadPhotos(db, buildId),
		handoff: loadHandoff(db, buildId, access.canEdit),
		started: undefined as never,
		skipped,
		customPieces
	};
	attachSpoolman(db, result, b.organizationId);
	result.started = buildStarted(result, liveJobs);
	return result;
}

/**
 * Where a plate's grams come from. A stored source wins. Older rows have none: grams on an uploaded
 * plate that match the file's own total (or, on a perPartRuns plate, are the same for every part, as
 * an upload writes them) came from the file; anything else was typed. With no slicer grams, a plate
 * whose `filamentGrams` come from the build's own slice (arranged / learned) reads 'slice'.
 */
export function gramsSourceOf(
	p: {
		source: string | null;
		slicerGrams: number | null;
		slicerByPart: Record<string, number>;
		perPartRuns: boolean;
		filamentGrams: Record<string, number> | null;
		slicerGramsSource: 'user' | 'file' | 'printer' | null;
	},
	arrangedGrams: Record<string, number> | undefined,
	learned: boolean
): 'user' | 'file' | 'printer' | 'slice' | null {
	const typed = p.perPartRuns
		? Object.values(p.slicerByPart)
		: p.slicerGrams
			? [p.slicerGrams]
			: [];
	const has = typed.some((v) => v > 0);
	if (!has) {
		const own = Object.values(p.source === 'arranged' || learned ? (arrangedGrams ?? {}) : {});
		return own.some((g) => g > 0) ? 'slice' : null;
	}
	if (p.slicerGramsSource) return p.slicerGramsSource;
	if (!p.source?.startsWith('upload:') && !isCustomSource(p.source)) return 'user';
	if (p.perPartRuns) return new Set(typed).size === 1 ? 'file' : 'user';
	const fileTotal = Object.values(p.filamentGrams ?? {}).reduce((a, b) => a + b, 0);
	return fileTotal > 0 && Math.abs(fileTotal - (p.slicerGrams ?? 0)) < 0.5 ? 'file' : 'user';
}

/** Persist domain patches onto build_parts. */
export function applyPatches(db: Db, buildId: string, patches: PartPatch[], now: Date): void {
	for (const { slug, ...p } of patches) {
		const set: Partial<typeof buildParts.$inferInsert> = { updatedAt: now };
		if (p.status !== undefined) set.status = p.status;
		if ('startedAt' in p) set.startedAt = p.startedAt ? new Date(p.startedAt) : null;
		if ('printedOn' in p) set.printedOn = p.printedOn ?? null;
		if ('runEstSeconds' in p) set.runEstSeconds = p.runEstSeconds ?? null;
		if (p.comps !== undefined) set.comps = p.comps;
		if ('printingComps' in p) set.printingComps = p.printingComps?.length ? p.printingComps : null;
		if ('assigneeUserId' in p) set.assigneeUserId = p.assigneeUserId ?? null;
		if ('manualGrams' in p) set.manualGrams = p.manualGrams ?? null;
		if (typeof p.skipped === 'boolean') set.skipped = p.skipped;
		db.update(buildParts)
			.set(set)
			.where(and(eq(buildParts.buildId, buildId), eq(buildParts.partSlug, slug)))
			.run();
	}
}

function loadAssembly(
	db: Db,
	buildId: string,
	templateId: string,
	choices: Record<string, string>,
	activeSlugs: Set<string>,
	skippedSlugs: Set<string>
): BuildAssembly {
	const rows = db
		.select()
		.from(templateAssemblySteps)
		.where(eq(templateAssemblySteps.templateId, templateId))
		.orderBy(asc(templateAssemblySteps.sort))
		.all()
		.map((r) => ({
			key: r.key,
			title: r.title,
			description: r.description,
			guidePage: r.guidePage,
			parts: r.parts,
			hardware: r.hardware,
			checks: r.checks,
			when: r.when ?? null
		}));
	// Step existence follows the variant-active parts; "Not printing" only thins the listed parts.
	const steps = filterSteps(rows, choices, activeSlugs, skippedSlugs);
	const items: BuildAssembly['items'] = {};
	for (const { a, userName } of db
		.select({ a: buildAssembly, userName: user.name })
		.from(buildAssembly)
		.leftJoin(user, eq(user.id, buildAssembly.doneBy))
		.where(eq(buildAssembly.buildId, buildId))
		.all()
		.map((x) => ({ a: x.a, userName: x.userName }))) {
		items[a.itemKey] = {
			done: a.done,
			note: a.note,
			doneBy: a.doneBy,
			doneByName: userName,
			doneAt: a.doneAt ? a.doneAt.toISOString() : null
		};
	}
	return { steps, items };
}

function loadPhotos(db: Db, buildId: string): BuildPhoto[] {
	return db
		.select({ p: buildPhotos, userName: user.name })
		.from(buildPhotos)
		.leftJoin(user, eq(user.id, buildPhotos.createdBy))
		.where(eq(buildPhotos.buildId, buildId))
		.orderBy(asc(buildPhotos.createdAt), asc(buildPhotos.id))
		.all()
		.map(({ p, userName }) => ({
			id: p.id,
			kind: p.kind as PhotoKind,
			caption: p.caption,
			width: p.width,
			height: p.height,
			createdBy: p.createdBy,
			createdByName: userName,
			createdAt: p.createdAt.toISOString()
		}));
}

/** The recipient contact is team-internal: only owners and editors receive it. */
function loadHandoff(db: Db, buildId: string, canSeeContact: boolean): HandoffRecord | null {
	const h = db.select().from(buildHandoff).where(eq(buildHandoff.buildId, buildId)).get();
	if (!h) return null;
	return {
		recipientName: h.recipientName,
		organization: h.organization,
		contact: canSeeContact ? h.contact : null,
		handedOffOn: h.handedOffOn,
		location: h.location,
		notes: h.notes,
		safetyChecked: h.safetyChecked,
		updatedBy: h.updatedBy,
		updatedAt: h.updatedAt ? h.updatedAt.toISOString() : null
	};
}
