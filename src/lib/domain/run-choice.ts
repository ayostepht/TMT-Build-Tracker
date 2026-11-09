/**
 * Which part a printer job covers on a perPartRuns plate (e.g. the wheel rims: one color per print).
 * Pure.
 */
import type { BuildView } from './types.ts';

export interface RunChoice {
	slug: string;
	/** Successful runs logged for this part. */
	done: number;
	/** Runs the plate asks for per part. */
	total: number;
	printed: boolean;
	printing: boolean;
}

/** One entry per part of a perPartRuns plate, in plate order; [] for other plates. */
export function runChoices(view: BuildView, plateNumber: number): RunChoice[] {
	const plate = view.plates.find((p) => p.number === plateNumber);
	if (!plate || !plate.perPartRuns) return [];
	return plate.parts
		.filter((s) => view.state[s])
		.map((slug) => ({
			slug,
			done: view.runs.filter(
				(r) => r.plateNumber === plateNumber && r.result === 'Success' && r.partSlug === slug
			).length,
			total: Math.max(1, plate.runs),
			printed: view.state[slug].status === 'Printed',
			printing: view.state[slug].status === 'Printing'
		}));
}

/**
 * Default part for a job on a perPartRuns plate: the one part already Printing, else the first part
 * (plate order) that is not Printed and still has runs left, else the first part. Never all of them.
 * Returns null for plates that are not perPartRuns (callers keep their own default).
 */
export function defaultRunParts(view: BuildView, plateNumber: number): string[] | null {
	const choices = runChoices(view, plateNumber);
	if (!choices.length) return null;
	const now = choices.filter((c) => c.printing);
	if (now.length === 1) return [now[0].slug];
	const next = choices.find((c) => !c.printed && c.done < c.total);
	return [(next ?? choices[0]).slug];
}
