import { and, eq } from 'drizzle-orm';
import { twinGroups, twinsOf, splitTwinRuns } from '#lib/domain/twins.ts';
import { inactiveSlugs, resolveChoices } from '#lib/domain/variants.ts';
import type { Db } from '../db';
import { buildPlates, builds, templateParts, templates } from '../db/schema';

export interface TwinRepair {
	buildId: string;
	plate: number;
	/** Parts on the plate before and after. */
	before: string[];
	after: string[];
	runsBefore: number;
	runsAfter: number;
}

/**
 * One-off repair for plates that an earlier upload apply made from a single object that stands for
 * several parts sharing a source object (the wheel rims): the plate held ONE twin, printed `n x twins`
 * runs as a whole-plate unit, and the other twins sat on no plate (counted again under "Other").
 *
 * Pattern: an uploaded plate, `perPartRuns` false, made only of one twin of a group, whose other active
 * twins are on no plate of the build, with runs divisible by the group's size. It becomes the twin plate
 * `applyUpload` makes today: all twins, `perPartRuns`, runs / twins, `slicerByPart` = the plate's grams per
 * run, `filamentGrams` {} (accounting takes the roles from the parts). Print runs are not touched.
 * Idempotent: a repaired plate (or the maintainer's hand-fixed ones) no longer matches. Returns what changed.
 */
export function repairTwinPlates(db: Db): TwinRepair[] {
	const done: TwinRepair[] = [];
	for (const b of db.select().from(builds).all()) {
		const rows = db.select().from(buildPlates).where(eq(buildPlates.buildId, b.id)).all();
		const uploaded = rows.filter((p) => p.source.startsWith('upload:') && !p.perPartRuns);
		if (!uploaded.length) continue;
		const tpl = db.select().from(templates).where(eq(templates.id, b.templateId)).get();
		if (!tpl) continue;
		const parts = db
			.select()
			.from(templateParts)
			.where(eq(templateParts.templateId, b.templateId))
			.all();
		const groups = twinGroups(parts);
		if (!groups.length) continue;
		const groupsV = tpl.variantGroups ?? [];
		const inactive = inactiveSlugs(groupsV, resolveChoices(groupsV, b.variantChoices));
		const placed = new Set(rows.flatMap((p) => p.parts));
		for (const pl of uploaded) {
			if (!pl.parts.length) continue;
			const group = twinsOf(pl.parts[0], groups).filter((s) => !inactive.has(s));
			if (group.length < 2) continue;
			// only the plate's own twin on it, every other twin unplaced, whole runs per twin
			if (pl.parts.length !== 1 || !group.includes(pl.parts[0])) continue;
			if (group.some((s) => s !== pl.parts[0] && placed.has(s))) continue;
			if (pl.runs < group.length || !splitTwinRuns(pl.runs, group.length).even) continue;
			const runsAfter = pl.runs / group.length;
			const grams = pl.slicerGrams && pl.slicerGrams > 0 ? pl.slicerGrams : null;
			db.update(buildPlates)
				.set({
					parts: group,
					perPartRuns: true,
					runs: runsAfter,
					slicerByPart: grams ? Object.fromEntries(group.map((s) => [s, grams])) : {},
					filamentGrams: {}
				})
				.where(and(eq(buildPlates.buildId, b.id), eq(buildPlates.number, pl.number)))
				.run();
			const r: TwinRepair = {
				buildId: b.id,
				plate: pl.number,
				before: pl.parts,
				after: group,
				runsBefore: pl.runs,
				runsAfter
			};
			console.log(
				`[tmt] twin repair: build ${b.id} plate ${pl.number}: parts ${pl.parts.join(',')} -> ${group.join(',')}, runs ${pl.runs} -> ${runsAfter} per part`
			);
			done.push(r);
			group.forEach((s) => placed.add(s));
		}
	}
	return done;
}
