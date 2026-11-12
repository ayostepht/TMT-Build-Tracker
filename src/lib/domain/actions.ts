/**
 * Status rules for parts. Pure: each function returns the patches the server
 * should persist; nothing is mutated.
 */
import { today } from './format.ts';
import { plateByNumber } from './accounting.ts';
import type { BuildView, PartPatch, PartStatus, PrintRunInput } from './types.ts';

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
	return [patch];
}

function hasLoggedSuccess(view: BuildView, slug: string): boolean {
	return view.runs.some(
		(r) =>
			r.plateNumber != null &&
			r.result === 'Success' &&
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
			runTargets(view, { ...r, plateNumber: r.plateNumber }).includes(slug)
	);
}

export function startPrinting(view: BuildView, slugs: string[], now: Date): PartPatch[] {
	const out: PartPatch[] = [];
	for (const slug of slugs) {
		const st = view.state[slug];
		if (st && (st.status !== 'Printing' || betweenRuns(view, slug))) {
			out.push({ slug, status: 'Printing', startedAt: now.toISOString() });
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
				if (st.startedAt || st.runEstSeconds != null) {
					out.push({ slug, status: 'Printing', startedAt: null, runEstSeconds: null });
				}
				continue;
			}
			out.push({
				slug,
				status: st.printedOn ? 'Printed' : 'To print',
				startedAt: null,
				runEstSeconds: null
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
export function applyRun(view: BuildView, run: PrintRunInput, now: Date): PartPatch[] {
	void now;
	const targets = runTargets(view, run).filter((s) => view.state[s]);
	if (!targets.length) return [];

	if (run.plateNumber == null) {
		const out: PartPatch[] = [];
		for (const slug of targets) {
			const st = view.state[slug];
			if (st.status === 'Printed') continue;
			if (run.result === 'Success') {
				out.push({
					slug,
					status: 'Printed',
					printedOn: run.date,
					startedAt: null,
					runEstSeconds: null
				});
			} else if (run.result === 'Failed') {
				out.push({ slug, status: 'Reprint', startedAt: null, runEstSeconds: null });
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
				(run.partSlug ? r.partSlug === run.partSlug : !r.partSlug)
		).length + (run.result === 'Success' ? 1 : 0);

	return targets.map((slug) => {
		const st = view.state[slug];
		const part = view.parts.find((p) => p.slug === slug);
		const patch: PartPatch = { slug, startedAt: null, runEstSeconds: null };
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
		}
		return patch;
	});
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
			(plate.perPartRuns ? r.partSlug === partSlug : !r.partSlug)
	).length;
	return { run: Math.min(wins + 1, needed), of: needed };
}
