/**
 * "Has this build started printing?" One definition shared by the server (guards that must not
 * rewrite plates or replace a design under a running print) and the UI (warning dialogs).
 * Pure: no DB, Svelte or Node imports.
 *
 * Started = any print run is logged, or any part is not "To print" (Printing, Printed or Reprint),
 * or a printer job linked to the build is live (printing / paused). Drafts are never started.
 */
import type { BuildView, StartedInfo } from './types.ts';

export type { StartedInfo };

/** Live (printing or paused) printer jobs linked to the build, as the server knows them. */
export interface LiveJobs {
	/** Number of live linked jobs. */
	count: number;
	/** Part slugs on those jobs. */
	slugs: Iterable<string>;
	/** Plate numbers those jobs print (jobs without a plate number are left out). */
	plates: number[];
}

const NONE: LiveJobs = { count: 0, slugs: [], plates: [] };

/**
 * `live` is either the full `LiveJobs` or, for callers that only know which parts are on a live
 * job (`livePrintingSlugs`), that set of slugs (counted as one job when non-empty).
 */
export function buildStarted(
	view: Pick<BuildView, 'state' | 'plates' | 'runs' | 'build'>,
	live?: LiveJobs | Iterable<string>
): StartedInfo {
	const lj: LiveJobs =
		live === undefined
			? NONE
			: Symbol.iterator in Object(live)
				? (() => {
						const slugs = [...(live as Iterable<string>)];
						return { count: slugs.length ? 1 : 0, slugs, plates: [] as number[] };
					})()
				: (live as LiveJobs);
	if (view.build.kind === 'draft')
		return {
			started: false,
			runs: 0,
			printed: 0,
			notToPrint: 0,
			printingParts: 0,
			printingPlates: [],
			liveJobs: 0,
			totalParts: Object.keys(view.state).length
		};
	const liveSlugs = new Set(lj.slugs);
	let printed = 0;
	let notToPrint = 0;
	const printing = new Set<string>(liveSlugs);
	const states = Object.values(view.state);
	for (const s of states) {
		if (s.status !== 'To print') notToPrint++;
		if (s.status === 'Printed') printed++;
		if (s.status === 'Printing') printing.add(s.slug);
	}
	const plates = new Set<number>(lj.plates);
	for (const pl of view.plates) if (pl.parts.some((s) => printing.has(s))) plates.add(pl.number);
	const runs = view.runs.length;
	return {
		started: runs > 0 || notToPrint > 0 || printing.size > 0 || lj.count > 0,
		runs,
		printed,
		notToPrint,
		printingParts: printing.size,
		printingPlates: [...plates].sort((a, b) => a - b),
		liveJobs: lj.count,
		totalParts: states.length
	};
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One sentence for dialogs: "Plate 4 is printing; 22 of 64 parts printed; 18 prints logged".
 * Empty string when nothing has started.
 */
export function startedSummary(info: StartedInfo): string {
	if (!info.started) return '';
	const bits: string[] = [];
	const pl = info.printingPlates;
	if (pl.length === 1) bits.push(`Plate ${pl[0]} is printing`);
	else if (pl.length > 1) bits.push(`Plates ${pl.join(', ')} are printing`);
	else if (info.printingParts > 0)
		bits.push(`${plural(info.printingParts, 'part is', 'parts are')} printing`);
	else if (info.liveJobs > 0)
		bits.push(`${plural(info.liveJobs, 'printer job is', 'printer jobs are')} running`);
	if (info.printed > 0) bits.push(`${info.printed} of ${info.totalParts} parts printed`);
	else if (info.notToPrint > info.printingParts)
		bits.push(`${plural(info.notToPrint, 'part has', 'parts have')} progress`);
	if (info.runs > 0) bits.push(`${plural(info.runs, 'print', 'prints')} logged`);
	return bits.join('; ');
}
