/**
 * Status rules for parts. Pure: each function returns the patches the server
 * should persist; nothing is mutated.
 */
import { today } from './format.ts';
import { plateByNumber } from './accounting.ts';
import type { BuildView, PartPatch, PartStatus, PrintRunInput } from './types.ts';

/** The most pieces a part's piece list may name (a sanity cap for request validation). */
export const MAX_PIECES = 200;

/**
 * A copy of `view` with `patches` applied to the part state, for optimistic updates in the
 * browser. Only fields a patch sets change; the server stays the authority and its re-fetched
 * view replaces this one.
 */
export function applyPatches(view: BuildView, patches: PartPatch[]): BuildView {
	if (!patches.length) return view;
	const state = { ...view.state };
	for (const { slug, ...fields } of patches) {
		const cur = state[slug];
		if (!cur) continue;
		const next = { ...cur };
		for (const [k, v] of Object.entries(fields)) {
			if (v !== undefined) (next as Record<string, unknown>)[k] = v;
		}
		state[slug] = next;
	}
	return { ...view, state };
}

/** Earliest printedOn accepted: the kit did not exist before 2020. */
export const PRINTED_ON_FLOOR = '2020-01-01';

/** A `YYYY-MM-DD` that is a real calendar date, from 2020-01-01 to today (local, like `today()`). */
export function validPrintedOn(value: unknown, now: Date): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const d = new Date(value + 'T00:00:00Z');
	return (
		!isNaN(d.getTime()) &&
		d.toISOString().slice(0, 10) === value &&
		value >= PRINTED_ON_FLOOR &&
		value <= today(now)
	);
}

/**
 * Status change for one part. `opts.printedOn` (already validated by the caller) is honoured only
 * when the new status is Printed: it is how Undo puts back the original printed date.
 */
export function setStatus(
	view: BuildView,
	slug: string,
	status: PartStatus,
	now: Date,
	opts: { printedOn?: string } = {}
): PartPatch[] {
	const st = view.state[slug];
	if (!st || st.status === status) return [];
	const patch: PartPatch = {
		slug,
		status,
		startedAt: status === 'Printing' ? now.toISOString() : null
	};
	if (status !== 'Printing') patch.runEstSeconds = null;
	if (status === 'Printed' && opts.printedOn) patch.printedOn = opts.printedOn;
	else if (status === 'Printed' && !st.printedOn) patch.printedOn = today(now);
	if (status === 'To print') patch.printedOn = null;
	// A status picked by hand ends any piece-level print: the pieces on the printer are no longer a list.
	if (st.printingComps) patch.printingComps = null;
	return [patch];
}

// ---- Pieces: "Print some pieces…" ----------------------------------------------------------------
//
// A part with several pieces (`PartDef.components`, ticked in `PartState.comps`) can go on the printer
// a few pieces at a time. While it does, the part is Printing with `printingComps` = those indexes.
// A run with `comps` ("piece run") covers exactly those pieces: Success ticks them (all ticked =
// Printed, else the part goes back to To print), Failed ticks none and flags Reprint. A piece run is a
// subset run: it never counts as one of a plate's runs.

/** A run that covers only some pieces of one part. */
export function isPieceRun(r: { comps?: readonly number[] | null }): boolean {
	return !!r.comps?.length;
}

/**
 * The pieces of a part that are on the printer as a piece print, read against its CURRENT components
 * (a kit update can change them under a stored `printingComps`): indexes that are not a piece of the
 * part are ignored, and when none remain, or the list covers every piece, or the part has fewer than
 * two pieces, the print counts as a whole-part print (null). Everything that reads `printingComps`
 * (Now printing, the row tag, `canPrintPieces`, the run safety net, printer jobs) goes through this.
 */
export function printingPieces(view: BuildView, slug: string): number[] | null {
	const raw = view.state[slug]?.printingComps;
	const n = view.parts.find((p) => p.slug === slug)?.components.length ?? 0;
	if (!raw?.length || n < 2) return null;
	const ok = [...new Set(raw)].filter((i) => Number.isInteger(i) && i >= 0 && i < n);
	return ok.length && ok.length < n ? ok.sort((a, b) => a - b) : null;
}

/** Indexes of a part's pieces that are not ticked yet, in order. */
export function piecesLeft(view: BuildView, slug: string): number[] {
	const part = view.parts.find((p) => p.slug === slug);
	const st = view.state[slug];
	if (!part || !st) return [];
	return part.components.map((_, i) => i).filter((i) => !st.comps?.[String(i)]);
}

/**
 * Can "Print some pieces…" be offered for this part? The part is To print or Reprint (not on the
 * printer, not Printed) with two or more pieces still unticked, no piece print is under way, and its
 * plate prints once (a multi-run plate counts whole runs and a perPartRuns plate one part per run: a
 * piece run would miscount them). A part on no plate qualifies. Callers add the editor/draft checks.
 */
export function canPrintPieces(view: BuildView, slug: string): boolean {
	const st = view.state[slug];
	if (!st || (st.status !== 'To print' && st.status !== 'Reprint')) return false;
	if (printingPieces(view, slug)) return false;
	if (piecesLeft(view, slug).length < 2) return false;
	const plate = view.plates.find((p) => p.parts.includes(slug));
	return !plate || (!plate.perPartRuns && plate.runs <= 1);
}

/**
 * Why `comps` cannot start (or be logged as) a piece print of `slug`, or null when it can: distinct
 * integer indexes of the part's pieces, fewer than all of them (all of them is a whole-part print).
 * For `start`, every index must still be unticked.
 */
export function pieceListError(
	view: BuildView,
	slug: string,
	comps: readonly unknown[],
	mode: 'start' | 'log'
): string | null {
	const part = view.parts.find((p) => p.slug === slug);
	if (!part || part.components.length < 2) return 'That part has no separate pieces';
	if (!comps.length) return 'Pick at least one piece';
	if (comps.length > MAX_PIECES || comps.length >= part.components.length)
		return 'Pick some of the pieces, not all of them (use the whole-part action for that)';
	const seen = new Set<number>();
	for (const c of comps) {
		if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= part.components.length)
			return 'Unknown piece';
		if (seen.has(c)) return 'A piece is listed twice';
		seen.add(c);
		if (mode === 'start' && view.state[slug]?.comps?.[String(c)])
			return 'A piece is already ticked';
	}
	return null;
}

/** The part's ticks with `comps` ticked on top (full record, every piece present). */
function withTicks(
	view: BuildView,
	slug: string,
	comps: readonly number[]
): Record<string, boolean> {
	const part = view.parts.find((p) => p.slug === slug);
	const cur = view.state[slug]?.comps ?? {};
	const out: Record<string, boolean> = {};
	(part?.components ?? []).forEach(
		(_, i) => (out[String(i)] = !!cur[String(i)] || comps.includes(i))
	);
	return out;
}

/**
 * Ticking pieces by hand (the part detail's checkboxes). A part with a piece print under way loses
 * the ticked pieces from `printingComps`; when none are left the print is over: the part is Printed
 * if every piece is ticked, else back to To print.
 */
export function setPieceTicks(
	view: BuildView,
	slug: string,
	comps: Record<string, boolean>,
	now: Date
): PartPatch[] {
	const st = view.state[slug];
	if (!st) return [];
	const patch: PartPatch = { slug, comps };
	const pc = st.printingComps;
	if (pc?.length) {
		const rest = pc.filter((i) => comps[String(i)] !== true);
		if (rest.length !== pc.length) {
			if (rest.length) patch.printingComps = rest;
			else {
				const part = view.parts.find((p) => p.slug === slug);
				const all = !!part && part.components.every((_, i) => comps[String(i)] === true);
				patch.printingComps = null;
				patch.startedAt = null;
				patch.runEstSeconds = null;
				patch.status = all ? 'Printed' : 'To print';
				if (all && !st.printedOn) patch.printedOn = today(now);
			}
		}
	}
	return [patch];
}

function hasLoggedSuccess(view: BuildView, slug: string): boolean {
	return view.runs.some(
		(r) =>
			r.plateNumber != null &&
			r.result === 'Success' &&
			!isPieceRun(r) &&
			runTargets(view, { ...r, plateNumber: r.plateNumber }).includes(slug)
	);
}

/**
 * A part of a multi-run plate that is marked Printing only because a run was logged and more are
 * needed: a successful run covers it, and it has no start time (logging a run clears it). Nothing
 * is on the printer for it right now; the next run starts it again.
 */
export function betweenRuns(view: BuildView, slug: string): boolean {
	const st = view.state[slug];
	if (!st || st.status !== 'Printing' || st.startedAt) return false;
	return view.runs.some(
		(r) =>
			r.plateNumber != null &&
			r.result === 'Success' &&
			!isPieceRun(r) &&
			runTargets(view, { ...r, plateNumber: r.plateNumber }).includes(slug)
	);
}

/** A live printer job already covering the parts: its real start and (optional) total run time. */
export interface LiveStart {
	startedAt: Date;
	runEstSeconds?: number | null;
}

/**
 * Mark parts Printing. `comps` (one slug only; the caller validated it with `pieceListError`) makes it
 * a piece-level print: the part is Printing with `printingComps` = those pieces. Without it a part
 * that carried a piece list goes back to a whole-part print.
 */
export function startPrinting(
	view: BuildView,
	slugs: string[],
	now: Date,
	live?: LiveStart | null,
	comps?: readonly number[] | null
): PartPatch[] {
	const out: PartPatch[] = [];
	const start =
		live && !isNaN(live.startedAt.getTime()) && live.startedAt < now ? live.startedAt : now;
	for (const slug of slugs) {
		const st = view.state[slug];
		if (st && (st.status !== 'Printing' || betweenRuns(view, slug))) {
			const patch: PartPatch = { slug, status: 'Printing', startedAt: start.toISOString() };
			if (live && start === live.startedAt && live.runEstSeconds != null) {
				patch.runEstSeconds = live.runEstSeconds;
			}
			if (comps?.length && slugs.length === 1)
				patch.printingComps = [...comps].sort((a, b) => a - b);
			else if (st.printingComps) patch.printingComps = null;
			out.push(patch);
		}
	}
	return out;
}

export function stopPrinting(view: BuildView, slugs: string[]): PartPatch[] {
	const out: PartPatch[] = [];
	for (const slug of slugs) {
		const st = view.state[slug];
		if (st && st.status === 'Printing') {
			// A logged successful run covers the part: taking the next run off the printer puts it
			// back between runs (still Printing, no start time), not back to To print.
			if (!st.printedOn && hasLoggedSuccess(view, slug)) {
				if (st.startedAt || st.runEstSeconds != null || st.printingComps) {
					out.push({
						slug,
						status: 'Printing',
						startedAt: null,
						runEstSeconds: null,
						...(st.printingComps ? { printingComps: null } : {})
					});
				}
				continue;
			}
			out.push({
				slug,
				status: st.printedOn ? 'Printed' : 'To print',
				startedAt: null,
				runEstSeconds: null,
				...(st.printingComps ? { printingComps: null } : {})
			});
		}
	}
	return out;
}

/** A cancelled or failed job under this progress (%) never really started. */
export const NO_PROGRESS_PCT = 1;
/** With no progress reported, a job that ended within this many seconds of its start counts as not started. */
export const NO_PROGRESS_MAX_ELAPSED_SEC = 600;

/**
 * Did a printer job that ended as cancelled/failed effectively never print? Conservative:
 * a completed layer beyond the first, or progress of 1% or more, means it did. With no
 * progress reported the print counts as not started only when it ended within
 * `NO_PROGRESS_MAX_ELAPSED_SEC` of its start; with neither known the user is asked.
 */
export function jobNeverStarted(i: {
	progress: number | null | undefined;
	layer?: number | null;
	elapsedSec?: number | null;
}): boolean {
	if (i.layer != null && i.layer > 1) return false;
	if (i.progress != null) return i.progress < NO_PROGRESS_PCT;
	return i.elapsedSec != null && i.elapsedSec < NO_PROGRESS_MAX_ELAPSED_SEC;
}

/** Set when the print started; a time in the future is clamped to `now`. */
export function setPrintStart(
	view: BuildView,
	slugs: string[],
	when: Date,
	now: Date
): PartPatch[] {
	if (isNaN(when.getTime())) return [];
	const iso = new Date(Math.min(when.getTime(), now.getTime())).toISOString();
	return slugs.filter((s) => view.state[s]).map((slug) => ({ slug, startedAt: iso }));
}

export function setRunEstimate(
	view: BuildView,
	slugs: string[],
	seconds: number | null
): PartPatch[] {
	return slugs.filter((s) => view.state[s]).map((slug) => ({ slug, runEstSeconds: seconds }));
}

/** Part slugs a logged run affects. */
export function runTargets(view: BuildView, run: PrintRunInput): string[] {
	if (run.plateNumber == null) return run.partSlug ? [run.partSlug] : [];
	const plate = plateByNumber(view, run.plateNumber);
	if (!plate) return run.partSlug ? [run.partSlug] : [];
	if (run.partSlug) return plate.parts.includes(run.partSlug) ? [run.partSlug] : [];
	const subset = run.partSlugs?.filter((s) => plate.parts.includes(s));
	if (subset && subset.length && subset.length < plate.parts.length) return subset;
	return plate.parts.slice();
}

/**
 * Patches for logging a run. `view.runs` must not yet include `run`.
 * A plate run: Success on the last needed run prints the parts (earlier ones
 * leave them Printing), Failed flags unprinted parts for Reprint. A part-log
 * run (no plate): Success prints, Failed flags for Reprint.
 */
export interface RunOpts {
	/**
	 * Slugs that are on a live printer job right now (status printing/paused). A Failed or Partial
	 * run leaves such a part alone (still Printing, start time and estimate kept): the print that
	 * is running is a newer attempt than the run being logged.
	 */
	livePrinting?: ReadonlySet<string>;
}

export function applyRun(
	view: BuildView,
	run: PrintRunInput,
	now: Date,
	opts: RunOpts = {}
): PartPatch[] {
	void now;
	const live = opts.livePrinting;
	const keepLive = (slug: string) =>
		run.result !== 'Success' && !!live?.has(slug) && view.state[slug]?.status === 'Printing';
	const targets = runTargets(view, run).filter((s) => view.state[s]);
	if (!targets.length) return [];
	// A run on the part's own pieces: it ticks (or fails) those pieces only.
	const slugOf = run.partSlug;
	if (slugOf && isPieceRun(run)) return applyPieceRun(view, run, slugOf, keepLive(slugOf));
	// The print that ends here is no longer a piece print.
	const endPieces = (slug: string): Partial<PartPatch> =>
		view.state[slug].printingComps ? { printingComps: null } : {};

	if (run.plateNumber == null) {
		const out: PartPatch[] = [];
		for (const slug of targets) {
			const st = view.state[slug];
			if (st.status === 'Printed' || keepLive(slug)) continue;
			if (run.result === 'Success') {
				out.push({
					slug,
					status: 'Printed',
					printedOn: run.date,
					startedAt: null,
					runEstSeconds: null,
					...endPieces(slug)
				});
			} else if (run.result === 'Failed') {
				out.push({
					slug,
					status: 'Reprint',
					startedAt: null,
					runEstSeconds: null,
					...endPieces(slug)
				});
			}
		}
		return out;
	}

	const plate = plateByNumber(view, run.plateNumber);
	const needed = Math.max(1, plate?.runs || 1);
	const wins =
		view.runs.filter(
			(r) =>
				r.plateNumber === run.plateNumber &&
				r.result === 'Success' &&
				!isPieceRun(r) &&
				(run.partSlug ? r.partSlug === run.partSlug : !r.partSlug)
		).length + (run.result === 'Success' ? 1 : 0);

	return targets.flatMap((slug): PartPatch[] => {
		if (keepLive(slug)) return [];
		const st = view.state[slug];
		const part = view.parts.find((p) => p.slug === slug);
		const patch: PartPatch = { slug, startedAt: null, runEstSeconds: null, ...endPieces(slug) };
		if (run.result === 'Success') {
			if (wins >= needed) {
				patch.status = 'Printed';
				if (!st.printedOn) patch.printedOn = run.date;
				if (part?.components.length) {
					patch.comps = Object.fromEntries(part.components.map((_, i) => [String(i), true]));
				}
			} else if (st.status !== 'Printed') {
				patch.status = 'Printing';
			}
		} else if (run.result === 'Failed' && st.status !== 'Printed') {
			patch.status = 'Reprint';
		} else if (st.printingComps && st.status === 'Printing') {
			// A Partial of a piece print: it is over; the pieces are not ticked.
			patch.status = 'To print';
		}
		return [patch];
	});
}

/** What a run on some pieces of one part does to the part (see the Pieces section above). */
function applyPieceRun(
	view: BuildView,
	run: PrintRunInput,
	slug: string,
	keepLive: boolean
): PartPatch[] {
	const st = view.state[slug];
	const part = view.parts.find((p) => p.slug === slug);
	if (!st || !part?.components.length || st.status === 'Printed' || keepLive) return [];
	const base: PartPatch = { slug, startedAt: null, runEstSeconds: null, printingComps: null };
	if (run.result === 'Success') {
		const comps = withTicks(view, slug, run.comps ?? []);
		return part.components.every((_, i) => comps[String(i)])
			? [{ ...base, status: 'Printed', printedOn: run.date, comps }]
			: [{ ...base, status: 'To print', comps }];
	}
	// Failed: nothing ticked, the part is flagged like any failed print. A Partial is not offered for
	// pieces; if one arrives it only ends the print on the printer.
	if (run.result === 'Failed') return [{ ...base, status: 'Reprint' }];
	return st.status === 'Printing' ? [{ ...base, status: 'To print' }] : [];
}

/** "Run 1 of 2" data, or null when only one run is needed. */
export function runInfo(
	view: BuildView,
	plateNumber: number,
	partSlug?: string
): { run: number; of: number } | null {
	const plate = plateByNumber(view, plateNumber);
	if (!plate) return null;
	if (plate.perPartRuns && !partSlug) return null;
	const needed = plate.runs;
	if (needed < 2) return null;
	const wins = view.runs.filter(
		(r) =>
			r.plateNumber === plateNumber &&
			r.result === 'Success' &&
			!isPieceRun(r) &&
			(plate.perPartRuns ? r.partSlug === partSlug : !r.partSlug)
	).length;
	return { run: Math.min(wins + 1, needed), of: needed };
}
