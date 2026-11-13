import { and, asc, desc, eq } from 'drizzle-orm';
import { filterSteps } from '#lib/domain/assembly.ts';
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
	PartDef,
	PartPatch,
	PartState,
	PartStatus,
	PartPlacement,
	Plate,
	PrintRun,
	RunResult,
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
	buildFilaments,
	buildHandoff,
	buildPhotos,
	buildParts,
	buildPlates,
	builds,
	member,
	printRuns,
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

export function loadBuildView(db: Db, buildId: string, userId: string): BuildView | null {
	const access = buildAccess(db, buildId, userId);
	if (!access) return null;
	const b = db.select().from(builds).where(eq(builds.id, buildId)).get();
	if (!b) return null;
	const tpl = db.select().from(templates).where(eq(templates.id, b.templateId)).get();
	if (!tpl) return null;

	const design = (b.design ?? null) as { partRoles?: Record<string, string> } | null;
	const partRoles = design?.partRoles ?? {};

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
				recommendedSpools: t?.recommendedSpools ?? 1,
				spoolmanSpoolId: f.spoolmanSpoolId
			};
		});
	// keep template role order
	const order = [...tRoles.keys()];
	// Colors added in the Design tab come after the template's own slots.
	const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
	filaments.sort((a, c) => rank(a.key) - rank(c.key));

	const variantGroups = tpl.variantGroups ?? [];
	const variantChoices = resolveChoices(variantGroups, b.variantChoices);
	const inactive = inactiveSlugs(variantGroups, variantChoices);
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
	const parts = allParts.filter((p) => !inactive.has(p.slug));

	const state: Record<string, PartState> = {};
	for (const s of db.select().from(buildParts).where(eq(buildParts.buildId, buildId)).all()) {
		if (inactive.has(s.partSlug)) continue;
		state[s.partSlug] = {
			slug: s.partSlug,
			status: s.status as PartStatus,
			startedAt: s.startedAt ? s.startedAt.toISOString() : null,
			printedOn: s.printedOn,
			runEstSeconds: s.runEstSeconds,
			comps: s.comps,
			assigneeUserId: s.assigneeUserId,
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
			assigneeUserId: null,
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
				(p) => p.source !== 'arranged' && !p.source?.startsWith('upload:') && !p.perPartRuns
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
							? p.source?.startsWith('upload:')
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
			date: r.date,
			result: r.result as RunResult,
			grams: r.grams,
			hours: r.hours,
			estSeconds: r.estSeconds,
			printer: r.printer,
			userId: r.userId,
			userName,
			note: r.note
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

	return {
		build: {
			id: b.id,
			organizationId: b.organizationId,
			name: b.name,
			recipient: b.recipient,
			hospital: b.hospital,
			kind: b.kind === 'draft' ? 'draft' : 'build',
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
		state,
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
		assembly: loadAssembly(db, buildId, tpl.id, variantChoices, parts),
		photos: loadPhotos(db, buildId),
		handoff: loadHandoff(db, buildId, access.canEdit)
	};
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
		if ('assigneeUserId' in p) set.assigneeUserId = p.assigneeUserId ?? null;
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
	activeParts: PartDef[]
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
	const steps = filterSteps(rows, choices, new Set(activeParts.map((p) => p.slug)));
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
