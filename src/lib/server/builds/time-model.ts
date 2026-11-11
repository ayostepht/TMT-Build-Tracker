/** Loads the print-time model (see domain/time-estimate.ts) for a template from its stored data. */
import { and, eq } from 'drizzle-orm';
import type { ArrangedPlate } from '#lib/domain/arrange.ts';
import {
	buildTimeModel,
	estimateArranged,
	type PlateTimeEstimate,
	type LearnedTime,
	type TimeLayoutPlate,
	type TimeModel
} from '#lib/domain/time-estimate.ts';
import type { Db } from '../db';
import { templateParts, templatePlateLayouts, templatePlates, templates } from '../db/schema';

export function loadTimeModel(
	db: Db,
	templateId: string,
	learned?: ReadonlyMap<string, LearnedTime>
): TimeModel {
	const parts = db
		.select({ slug: templateParts.slug, bomGrams: templateParts.bomGrams, qty: templateParts.qty })
		.from(templateParts)
		.where(eq(templateParts.templateId, templateId))
		.all();
	const layouts = db
		.select()
		.from(templatePlateLayouts)
		.where(eq(templatePlateLayouts.templateId, templateId))
		.all();
	const xpa = layouts.find((l) => l.key === 'xpa') ?? layouts.find((l) => l.isDefault);
	const plates: TimeLayoutPlate[] = xpa
		? xpa.plates
		: db
				.select()
				.from(templatePlates)
				.where(and(eq(templatePlates.templateId, templateId)))
				.all();
	const groups = db
		.select({ g: templates.variantGroups })
		.from(templates)
		.where(eq(templates.id, templateId))
		.get()?.g;
	return buildTimeModel(parts, plates, groups ?? [], learned);
}

/** Estimates (per run) for arranged plates, by plate number. */
export function estimateArrangedPlates(
	model: TimeModel,
	plates: { number: number; runs: number; arrangement: ArrangedPlate | null; parts: string[] }[]
): Map<number, PlateTimeEstimate> {
	return estimateArranged(
		model,
		plates.map((p) => ({
			number: p.number,
			runs: p.runs,
			items: p.arrangement?.items.length
				? p.arrangement.items.flatMap((i) => (i ? [i.slug] : []))
				: p.parts
		}))
	);
}
