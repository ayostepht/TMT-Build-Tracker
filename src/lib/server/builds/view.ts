import { and, asc, desc, eq } from 'drizzle-orm';
import { inactiveSlugs, resolveChoices, variantOfPart } from '#lib/domain/variants.ts';
import type {
	ActivityItem,
	BuildPhase,
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
import { buildAccess } from '../access';
import { hardwareModelUrl } from '../models/hardware';
import type { Db } from '../db';
import {
	activity,
	buildFilaments,
	buildParts,
	buildPlates,
	builds,
	member,
	printRuns,
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
		if (source?.startsWith('upload:')) return null;
		return runNotes.get(number) ?? null;
	};
	const plates: Plate[] = db
		.select()
		.from(buildPlates)
		.where(eq(buildPlates.buildId, buildId))
		.orderBy(asc(buildPlates.number))
		.all()
		.map((p) => ({
			number: p.number,
			name: p.name,
			estSeconds: p.estSeconds,
			runs: p.runs,
			runNote: noteFor(p.source, p.number),
			perPartRuns: p.perPartRuns,
			parts: p.parts,
			slicerGrams: p.slicerGrams,
			slicerByPart: p.slicerByPart,
			thumbnailPath: p.thumbnailPath,
			filamentGrams: p.filamentGrams ?? {},
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
			phase: b.phase as BuildPhase,
			deliveryDate: b.deliveryDate,
			createdAt: b.createdAt.toISOString(),
			templateId: tpl.id,
			templateName: tpl.name,
			templateVersion: tpl.version,
			globalSettings: tpl.globalSettings,
			sections: tpl.sections
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
		plates,
		runs,
		guidePages: db
			.select()
			.from(templateGuidePages)
			.where(eq(templateGuidePages.templateId, tpl.id))
			.orderBy(asc(templateGuidePages.sort))
			.all()
			.map((g) => ({ page: g.page, title: g.title, sort: g.sort, hasImage: false })),
		hardware: db
			.select()
			.from(templateHardware)
			.where(eq(templateHardware.templateId, tpl.id))
			.all()
			.map((h) => ({ name: h.name, qty: h.qty, note: h.note })),
		activity: acts,
		members
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
