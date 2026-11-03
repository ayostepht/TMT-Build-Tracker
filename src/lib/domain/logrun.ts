/** Pure helpers for the "log a print" sheet: prefill values, the outcome summary and undo snapshots. */
import { applyRun, runInfo, runTargets } from './actions.ts';
import { fmtHM } from './format.ts';
import type { BuildView, PartPatch, PartState, PrintRunInput, RunResult } from './types.ts';

/** The fields of a part's state an undo must put back. */
export type PartSnapshot = Pick<
	PartState,
	'slug' | 'status' | 'startedAt' | 'printedOn' | 'runEstSeconds' | 'comps'
>;

export function snapshotParts(view: BuildView, slugs: string[]): PartSnapshot[] {
	const out: PartSnapshot[] = [];
	for (const slug of slugs) {
		const st = view.state[slug];
		if (!st) continue;
		out.push({
			slug,
			status: st.status,
			startedAt: st.startedAt,
			printedOn: st.printedOn,
			runEstSeconds: st.runEstSeconds,
			comps: { ...st.comps }
		});
	}
	return out;
}

/** Seconds between a start and a finish (finish clamped to `now`); null when unknown or not positive. */
export function elapsedSeconds(
	startedAt: string | null,
	finishedAt: Date,
	now: Date = new Date()
): number | null {
	if (!startedAt) return null;
	const start = Date.parse(startedAt);
	if (Number.isNaN(start)) return null;
	const end = Math.min(finishedAt.getTime(), now.getTime());
	const s = Math.round((end - start) / 1000);
	return s > 0 ? s : null;
}

/** Hours for the API: seconds / 3600, rounded to 0.1. */
export function hoursFromSeconds(seconds: number | null): number | null {
	return seconds == null ? null : Math.round((seconds / 3600) * 10) / 10;
}

function list(items: string[]): string {
	if (items.length <= 1) return items[0] ?? '';
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** One sentence on what saving this run will do to the parts. Empty when no result is chosen. */
export function runOutcomeSummary(
	view: BuildView,
	input: Omit<PrintRunInput, 'result'> & { result: RunResult | null }
): string {
	if (!input.result) return '';
	const full: PrintRunInput = { ...input, result: input.result };
	const targets = runTargets(view, full).filter((s) => view.state[s]);
	if (!targets.length) return 'Adds this run to the print log.';
	const name = (slug: string) => view.parts.find((p) => p.slug === slug)?.name ?? slug;
	const patches = applyRun(view, full, new Date());
	const names = (ps: PartPatch[]) => list(ps.map((p) => name(p.slug)));

	const printed = patches.filter((p) => p.status === 'Printed');
	const reprint = patches.filter((p) => p.status === 'Reprint');
	const staying = patches.filter((p) => p.status === 'Printing');

	if (printed.length) return `Marks ${names(printed)} printed.`;
	if (reprint.length) return `Flags ${names(reprint)} for reprint.`;
	if (staying.length) {
		const info =
			full.plateNumber != null ? runInfo(view, full.plateNumber, full.partSlug ?? undefined) : null;
		return info
			? `Run ${info.run} of ${info.of}: parts stay on the printer for the next run.`
			: 'Parts stay on the printer for the next run.';
	}
	return input.result === 'Partial'
		? 'Adds a partial print to the log; part status stays as it is.'
		: 'Adds this run to the print log; part status stays as it is.';
}

/** "13h 07m" for the duration input from seconds, or ''. */
export const durText = (seconds: number | null): string => (seconds ? fmtHM(seconds) : '');
