/** Pure helpers for the "log a print" sheet: prefill values, the outcome summary and undo snapshots. */
import { weightShare } from './accounting.ts';
import { applyRun, runInfo, runTargets } from './actions.ts';
import { fmtHM } from './format.ts';
import type {
	BuildView,
	PartPatch,
	PartState,
	PrintRun,
	PrintRunInput,
	RunResult
} from './types.ts';

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

/** A Partial needs at least one target ticked as printed OK and at least one left unticked. */
export function partialTicksOk(targets: readonly string[], kept: readonly string[]): boolean {
	const t = new Set(targets);
	const k = new Set(kept.filter((s) => t.has(s)));
	return k.size >= 1 && k.size < t.size;
}

/** What a Partial's second half says about the parts: which printed OK, and the grams of each half. */
export interface PartialSplit {
	keptSlugs: string[];
	keptGrams: number | null;
	lostGrams: number | null;
}

/** The two runs one Partial becomes: the parts that printed OK (Success) and the rest (Failed). */
export interface PartialRuns {
	kept: PrintRunInput & { estSeconds: number | null };
	lost: PrintRunInput & { estSeconds: number | null };
	/** Parts of each half, in plate order. */
	keptSlugs: string[];
	lostSlugs: string[];
	/** The kept parts' share (0 to 1) of the print by estimated grams: hours and run time are split by it. */
	share: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Turn a Partial into its two runs: a Success run for the ticked parts and a Failed run for the
 * rest. Hours and the run's planned time (`estSeconds`) split by the parts' estimated grams
 * (`partWeights`); the grams are the two the maker gave. Null when the ticks are not a
 * non-empty strict subset of what the run covers. Pure.
 */
export function splitPartial(
	view: BuildView,
	base: PrintRunInput,
	split: PartialSplit,
	estSeconds: number | null = null
): PartialRuns | null {
	const targets = runTargets(view, base).filter((s) => view.state[s]);
	const ticked = new Set(split.keptSlugs);
	if (!partialTicksOk(targets, split.keptSlugs)) return null;
	const keptSlugs = targets.filter((s) => ticked.has(s));
	const lostSlugs = targets.filter((s) => !ticked.has(s));
	const share = weightShare(view, targets, keptSlugs);
	const keptHours = base.hours == null ? null : round1(base.hours * share);
	const lostHours =
		base.hours == null || keptHours == null ? null : Math.max(0, round1(base.hours - keptHours));
	const keptEst = estSeconds == null ? null : Math.round(estSeconds * share);
	const lostEst = estSeconds == null || keptEst == null ? null : Math.max(0, estSeconds - keptEst);
	return {
		kept: {
			...base,
			partSlug: null,
			partSlugs: keptSlugs,
			result: 'Success',
			grams: split.keptGrams,
			hours: keptHours,
			estSeconds: keptEst
		},
		lost: {
			...base,
			partSlug: null,
			partSlugs: lostSlugs,
			result: 'Failed',
			grams: split.lostGrams,
			hours: lostHours,
			estSeconds: lostEst
		},
		keptSlugs,
		lostSlugs,
		share
	};
}

/**
 * Grams to prefill for a Partial's two halves: the plate's grams per run scaled by how far the
 * failed parts got (`progress`, 0 to 100). Kept is the ticked parts' full share by estimated grams. Nulls when the grams or the progress are unknown or the ticks are not valid.
 */
export function partialPrefill(
	view: BuildView,
	targets: readonly string[],
	keptSlugs: readonly string[],
	totalGrams: number | null | undefined,
	progress: number | null | undefined
): { keptGrams: number | null; lostGrams: number | null } {
	const none = { keptGrams: null, lostGrams: null };
	if (!totalGrams || totalGrams <= 0) return none;
	if (!partialTicksOk(targets, keptSlugs)) return none;
	// The ticked parts printed in full: their whole share is kept. The rest used `progress`% of theirs.
	const share = weightShare(view, [...targets], [...keptSlugs]);
	const keptGrams = Math.round(totalGrams * share);
	const lostGrams = Math.round(
		(totalGrams * (1 - share) * Math.min(100, Math.max(0, progress ?? 0))) / 100
	);
	return {
		keptGrams: keptGrams > 0 ? keptGrams : null,
		lostGrams: lostGrams > 0 ? lostGrams : null
	};
}

/**
 * One sentence on what saving this run will do to the parts. Empty when no result is chosen.
 * `keptSlugs` (a Partial with per-part results) names the parts that printed OK: "Marks A, B
 * printed; flags C for reprint."
 */
export function runOutcomeSummary(
	view: BuildView,
	input: Omit<PrintRunInput, 'result'> & { result: RunResult | null },
	keptSlugs: readonly string[] | null = null
): string {
	if (!input.result) return '';
	const full: PrintRunInput = { ...input, result: input.result };
	const targets = runTargets(view, full).filter((s) => view.state[s]);
	if (!targets.length) return 'Adds this run to the print log.';
	const name = (slug: string) => view.parts.find((p) => p.slug === slug)?.name ?? slug;
	if (full.result === 'Partial' && keptSlugs) {
		const runs = splitPartial(view, full, {
			keptSlugs: [...keptSlugs],
			keptGrams: null,
			lostGrams: null
		});
		if (!runs) return '';
		const now = new Date();
		const marked = [...applyRun(view, runs.kept, now), ...applyRun(view, runs.lost, now)];
		const ok = marked.filter((p) => p.status === 'Printed').map((p) => name(p.slug));
		const redo = marked.filter((p) => p.status === 'Reprint').map((p) => name(p.slug));
		const bits = [
			ok.length ? `Marks ${list(ok)} printed` : '',
			redo.length ? `${ok.length ? 'flags' : 'Flags'} ${list(redo)} for reprint` : ''
		].filter(Boolean);
		return bits.length
			? `${bits.join('; ')}.`
			: 'Adds a printed log and a failed log; part status stays as it is.';
	}
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

/** Runs that count toward a part: its own part-log runs plus plate runs that cover it. View order. */
export function partRuns(view: BuildView, slug: string): PrintRun[] {
	return view.runs.filter((r) =>
		r.plateNumber == null ? r.partSlug === slug : runTargets(view, r).includes(slug)
	);
}

/**
 * Grams to prefill for a print that stopped part-way: the plate/run grams scaled by the
 * printer-reported progress (0-100), rounded. Null when either is unknown or it rounds to 0.
 */
export function progressGrams(
	total: number | null | undefined,
	progress: number | null | undefined
): number | null {
	if (!total || total <= 0 || progress == null || !(progress > 0)) return null;
	const g = Math.round((total * Math.min(100, progress)) / 100);
	return g > 0 ? g : null;
}

/**
 * Grams typed in a log field. '' is "no grams" (null); a number 0 or more (decimal comma accepted)
 * is that number; anything else is `NaN`, which the sheet shows as an inline message.
 */
export function parseGrams(text: string): number | null {
	const t = text.trim().replace(',', '.');
	if (t === '') return null;
	return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}
