/**
 * Status rules for parts. Pure: each function returns the patches the server
 * should persist; nothing is mutated.
 */
import { today } from './format.ts';
import { plateByNumber } from './accounting.ts';
import type { BuildView, PartPatch, PartStatus, PrintRunInput } from './types.ts';

export function setStatus(
	view: BuildView,
	slug: string,
	status: PartStatus,
	now: Date
): PartPatch[] {
	const st = view.state[slug];
	if (!st || st.status === status) return [];
	const patch: PartPatch = {
		slug,
		status,
		startedAt: status === 'Printing' ? now.toISOString() : null
	};
	if (status !== 'Printing') patch.runEstSeconds = null;
	if (status === 'Printed' && !st.printedOn) patch.printedOn = today(now);
	if (status === 'To print') patch.printedOn = null;
	return [patch];
}

export function startPrinting(view: BuildView, slugs: string[], now: Date): PartPatch[] {
	const out: PartPatch[] = [];
	for (const slug of slugs) {
		const st = view.state[slug];
		if (st && st.status !== 'Printing') {
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
