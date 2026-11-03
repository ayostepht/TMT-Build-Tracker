import { and, eq } from 'drizzle-orm';
import type { Db } from '../db';
import {
	colorDesigns,
	templateFilamentRoles,
	templateGuidePages,
	templateHardware,
	templatePartPlacements,
	templateParts,
	templatePlateLayouts,
	templatePlates,
	templatePrintGeometry,
	templates
} from '../db/schema';
import { seedToFootprint } from '#lib/domain/print-footprint.ts';
import type { TemplateSeed } from './types';

/** `template_print_geometry.source_note` of rows that come from the seed (no mesh). */
export const SEED_NOTE = 'seed';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface SeedResult {
	/** Slugs of templates created from scratch. */
	inserted: string[];
	/** Slugs of existing templates that gained or changed something. */
	updated: string[];
}

/**
 * Brings the database in line with the seeds. Idempotent; one transaction per template.
 *
 * - New template: inserted whole.
 * - Existing template (matched by slug): reconciled. Missing parts, plates, filament
 *   roles, guide pages, hardware, designs and placements are inserted; static fields
 *   of parts, plates, roles and the template row (name, version, sections, variant
 *   groups, ...) are updated to the seed's values. Nothing is ever deleted, builds are
 *   never touched (existing builds get their new `build_parts` rows from
 *   `backfillBuildParts`), and placements already in the database are left alone because
 *   they can be edited in the app.
 */
export function seedTemplates(db: Db, seeds: TemplateSeed[]): SeedResult {
	const inserted: string[] = [];
	const updated: string[] = [];
	for (const s of seeds) {
		const existing = db
			.select({ id: templates.id })
			.from(templates)
			.where(eq(templates.slug, s.slug))
			.get();
		const changed = db.transaction((tx) => reconcileTemplate(tx, s, existing?.id ?? null));
		if (!existing) inserted.push(s.slug);
		else if (changed) updated.push(s.slug);
	}
	return { inserted, updated };
}

function reconcileTemplate(tx: Tx, s: TemplateSeed, existingId: string | null): boolean {
	let changed = false;
	const row = {
		name: s.name,
		version: s.version,
		description: s.description,
		sourceUrl: s.sourceUrl ?? null,
		globalSettings: s.globalSettings,
		sections: s.sections,
		variantGroups: s.variantGroups ?? []
	};
	let templateId: string;
	if (existingId) {
		templateId = existingId;
		const cur = tx.select().from(templates).where(eq(templates.id, templateId)).get()!;
		if (JSON.stringify(pick(cur, row)) !== JSON.stringify(row)) {
			tx.update(templates).set(row).where(eq(templates.id, templateId)).run();
			changed = true;
		}
	} else {
		templateId = tx
			.insert(templates)
			.values({ slug: s.slug, ...row })
			.returning({ id: templates.id })
			.get().id;
	}

	// Filament roles
	const roles = new Map(
		tx
			.select()
			.from(templateFilamentRoles)
			.where(eq(templateFilamentRoles.templateId, templateId))
			.all()
			.map((r) => [r.key, r])
	);
	for (const r of s.filamentRoles) {
		const cur = roles.get(r.key);
		if (!cur) {
			tx.insert(templateFilamentRoles)
				.values({ templateId, ...r })
				.run();
			changed = true;
		} else if (JSON.stringify(pick(cur, r)) !== JSON.stringify(r)) {
			tx.update(templateFilamentRoles)
				.set(r)
				.where(
					and(
						eq(templateFilamentRoles.templateId, templateId),
						eq(templateFilamentRoles.key, r.key)
					)
				)
				.run();
			changed = true;
		}
	}

	// Parts
	const parts = new Map(
		tx
			.select()
			.from(templateParts)
			.where(eq(templateParts.templateId, templateId))
			.all()
			.map((p) => [p.slug, p])
	);
	s.parts.forEach((p, i) => {
		const values = {
			name: p.name,
			section: p.section,
			defaultRole: p.defaultRole,
			bomGrams: p.bomGrams,
			qty: p.qty,
			walls: p.walls,
			infill: p.infill,
			supports: p.supports,
			brim: p.brim ?? null,
			sourceFile: p.sourceFile,
			notes: p.notes,
			components: p.components ?? [],
			allowedMaterials: p.allowedMaterials,
			symmetryGroup: p.symmetryGroup ?? null,
			guideRefs: p.guideRefs,
			sort: i
		};
		const cur = parts.get(p.slug);
		if (!cur) {
			tx.insert(templateParts)
				.values({ templateId, slug: p.slug, ...values })
				.run();
			changed = true;
		} else if (JSON.stringify(pick(cur, values)) !== JSON.stringify(values)) {
			tx.update(templateParts)
				.set(values)
				.where(and(eq(templateParts.templateId, templateId), eq(templateParts.slug, p.slug)))
				.run();
			changed = true;
		}
	});

	// Plates
	const plates = new Map(
		tx
			.select()
			.from(templatePlates)
			.where(eq(templatePlates.templateId, templateId))
			.all()
			.map((p) => [p.number, p])
	);
	for (const p of s.plates) {
		const values = {
			name: p.name,
			estSeconds: p.estSeconds,
			runs: p.runs,
			runNote: p.runNote ?? null,
			perPartRuns: p.perPartRuns ?? false,
			parts: p.parts
		};
		const cur = plates.get(p.number);
		if (!cur) {
			tx.insert(templatePlates)
				.values({ templateId, number: p.number, ...values })
				.run();
			changed = true;
		} else if (JSON.stringify(pick(cur, values)) !== JSON.stringify(values)) {
			tx.update(templatePlates)
				.set(values)
				.where(and(eq(templatePlates.templateId, templateId), eq(templatePlates.number, p.number)))
				.run();
			changed = true;
		}
	}

	// Plate layouts (insert missing, update static fields)
	const layouts = new Map(
		tx
			.select()
			.from(templatePlateLayouts)
			.where(eq(templatePlateLayouts.templateId, templateId))
			.all()
			.map((l) => [l.key, l])
	);
	(s.plateLayouts ?? []).forEach((l, i) => {
		const values = {
			name: l.name,
			printerNote: l.printerNote,
			isDefault: l.isDefault ?? false,
			plates: l.plates.map((p) => ({
				number: p.number,
				name: p.name,
				estSeconds: p.estSeconds,
				runs: p.runs,
				...(p.runNote ? { runNote: p.runNote } : {}),
				...(p.perPartRuns ? { perPartRuns: true } : {}),
				parts: p.parts
			})),
			sort: i
		};
		const cur = layouts.get(l.key);
		if (!cur) {
			tx.insert(templatePlateLayouts)
				.values({ templateId, key: l.key, ...values })
				.run();
			changed = true;
		} else if (JSON.stringify(pick(cur, values)) !== JSON.stringify(values)) {
			tx.update(templatePlateLayouts)
				.set(values)
				.where(
					and(eq(templatePlateLayouts.templateId, templateId), eq(templatePlateLayouts.key, l.key))
				)
				.run();
			changed = true;
		}
	});

	// Guide pages (insert missing, update titles)
	const pages = new Map(
		tx
			.select()
			.from(templateGuidePages)
			.where(eq(templateGuidePages.templateId, templateId))
			.all()
			.map((g) => [g.page, g])
	);
	for (const g of s.guidePages) {
		const cur = pages.get(g.page);
		if (!cur) {
			tx.insert(templateGuidePages)
				.values({ templateId, ...g })
				.run();
			changed = true;
		} else if (cur.title !== g.title || cur.sort !== g.sort) {
			tx.update(templateGuidePages)
				.set({ title: g.title, sort: g.sort })
				.where(
					and(eq(templateGuidePages.templateId, templateId), eq(templateGuidePages.page, g.page))
				)
				.run();
			changed = true;
		}
	}

	// Hardware (insert missing only)
	const hw = new Set(
		tx
			.select({ name: templateHardware.name })
			.from(templateHardware)
			.where(eq(templateHardware.templateId, templateId))
			.all()
			.map((h) => h.name)
	);
	for (const h of s.hardware) {
		if (hw.has(h.name)) continue;
		tx.insert(templateHardware)
			.values({ templateId, name: h.name, qty: h.qty ?? null, note: h.note ?? null })
			.run();
		changed = true;
	}

	// Color designs (insert missing only; designs may be edited by users later)
	const designs = new Set(
		tx
			.select({ slug: colorDesigns.slug })
			.from(colorDesigns)
			.where(eq(colorDesigns.templateId, templateId))
			.all()
			.map((d) => d.slug)
	);
	for (const d of s.designs) {
		if (designs.has(d.slug)) continue;
		tx.insert(colorDesigns)
			.values({
				templateId,
				slug: d.slug,
				name: d.name,
				roles: d.roles,
				partRoles: d.partRoles,
				isPublic: true
			})
			.run();
		changed = true;
	}

	// Placements (insert missing only; admins can edit them in the app). Parts the seed
	// does not mention get an unplaced identity row so every part has one.
	const placed = new Set(
		tx
			.select({ slug: templatePartPlacements.slug })
			.from(templatePartPlacements)
			.where(eq(templatePartPlacements.templateId, templateId))
			.all()
			.map((p) => p.slug)
	);
	const placements = new Map((s.placements ?? []).map((p) => [p.slug, p]));
	if (s.placements) {
		for (const part of s.parts) {
			if (placed.has(part.slug)) continue;
			const p = placements.get(part.slug);
			tx.insert(templatePartPlacements)
				.values({
					templateId,
					slug: part.slug,
					matrix: p?.matrix ?? IDENTITY,
					instances: p?.instances ?? [],
					placed: p?.placed ?? false
				})
				.run();
			changed = true;
		}
	}
	// Print footprints: insert missing; update rows that still hold seed values (imported geometry wins).
	for (const f of s.printFootprints ?? []) {
		const fp = seedToFootprint(f);
		if (!fp.pieces.length || !s.parts.some((p) => p.slug === f.slug)) continue;
		const cur = tx
			.select({
				note: templatePrintGeometry.sourceNote,
				footprint: templatePrintGeometry.footprint
			})
			.from(templatePrintGeometry)
			.where(
				and(
					eq(templatePrintGeometry.templateId, templateId),
					eq(templatePrintGeometry.slug, f.slug)
				)
			)
			.get();
		const big = fp.pieces.reduce((a, b) => (b.w * b.d > a.w * a.d ? b : a));
		const row = {
			footprint: fp as unknown as Record<string, unknown>,
			hull: (fp.pieces[0]?.hull ?? []) as [number, number][],
			height: big.h,
			tris: 0,
			settings: {},
			meshPath: '',
			sourceNote: SEED_NOTE,
			updatedAt: new Date()
		};
		if (!cur) {
			tx.insert(templatePrintGeometry)
				.values({ templateId, slug: f.slug, ...row })
				.run();
			changed = true;
		} else if (cur.note === SEED_NOTE && JSON.stringify(cur.footprint) !== JSON.stringify(fp)) {
			tx.update(templatePrintGeometry)
				.set(row)
				.where(
					and(
						eq(templatePrintGeometry.templateId, templateId),
						eq(templatePrintGeometry.slug, f.slug)
					)
				)
				.run();
			changed = true;
		}
	}
	return changed;
}

/** The subset of `cur` with the keys of `want`, in `want`'s key order, for comparison. */
function pick(cur: object, want: object): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of Object.keys(want)) out[k] = (cur as Record<string, unknown>)[k];
	return out;
}
