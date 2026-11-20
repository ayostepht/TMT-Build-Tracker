/**
 * Pace calibration: how the build's real print times compare with the plates' times.
 * Each run is compared with the best time its plate has (`Plate.estSeconds`, already chosen
 * by precedence slicer > learned print template > MakeGood profile > our estimate), weighted
 * by hours (sum of actual over sum of estimated). Failed and partial runs, runs with no hours,
 * part-subset runs (parts or pieces) and outliers (under 30% or over 300% of the plate time) are ignored.
 * Pure: no DB, no Svelte.
 */
import { fmtH } from './format.ts';
import type { BuildView, Plate, PrintRun } from './types.ts';

/** Estimated hours of usable timed runs before a pace is trusted. */
export const PACE_MIN_HOURS = 12;
export const PACE_OUTLIER_LOW = 0.3;
export const PACE_OUTLIER_HIGH = 3;

export interface Pace {
	/** actual / estimated: 0.93 means prints finish 7% sooner than the plate times. */
	ratio: number;
	/** Logged hours the pace is based on. */
	sampleHours: number;
	/** Estimated hours of those same runs. */
	estHours: number;
	runs: number;
	/** What the times mostly come from: 'slicer' (slicer or learned) or 'estimate'. */
	basis: 'slicer' | 'estimate';
	/** "you print 7% faster than the slicer" */
	text: string;
}

export function paceText(ratio: number, basis: 'slicer' | 'estimate' = 'slicer'): string {
	const pct = Math.round(Math.abs(1 - ratio) * 100);
	const vs = basis === 'slicer' ? 'the slicer' : 'the estimates';
	if (pct === 0) return `you print right on ${vs}`;
	return `you print ${pct}% ${ratio < 1 ? 'faster' : 'slower'} than ${vs}`;
}

/** A run usable for pace: the actual and planned hours, and whether the plan is the run's own time. */
export interface TimedRun {
	actual: number;
	est: number;
	/** The planned time is the run's own (`estSeconds`), not the plate's. */
	own: boolean;
	plate: Plate;
}

/**
 * The run as a pace sample, or null when it is not one: not a Success, no hours, no plate or time,
 * a part subset without its own time, the log sheet's prefill, or an outlier (see the file header).
 */
export function timedRun(view: BuildView, r: PrintRun): TimedRun | null {
	const h = Number(r.hours) || 0;
	if (!(h > 0) || r.result !== 'Success' || r.plateNumber == null) return null;
	// Some pieces of one part are a subset run: they never stand for the whole plate's time.
	if (r.comps?.length) return null;
	const pl = view.plates.find((p) => p.number === r.plateNumber);
	// The run's own time (what was planned when it was logged) comes before the plate's.
	const own = r.estSeconds && r.estSeconds > 0 ? r.estSeconds : 0;
	const sec = own || pl?.estSeconds || 0;
	if (!pl || !sec) return null;
	// A subset of a plate's parts does not take the whole plate's time.
	if (!own && !pl.perPartRuns && r.partSlugs && r.partSlugs.length < pl.parts.length) return null;
	const e = sec / 3600;
	// A time that is exactly the plate's own time is the log sheet's prefill, not a measurement.
	if (h === Math.round(e * 10) / 10) return null;
	if (h < e * PACE_OUTLIER_LOW || h > e * PACE_OUTLIER_HIGH) return null;
	return { actual: h, est: e, own: !!own, plate: pl };
}

export function paceOf(view: BuildView): Pace | null {
	let est = 0;
	let actual = 0;
	let runs = 0;
	let slicerEst = 0;
	for (const r of view.runs) {
		const t = timedRun(view, r);
		if (!t) continue;
		est += t.est;
		actual += t.actual;
		runs++;
		const src = t.plate.estSource;
		if (t.own || src === 'slicer' || src === 'learned' || src === 'manual') slicerEst += t.est;
	}
	if (est < PACE_MIN_HOURS) return null;
	const ratio = actual / est;
	const basis = slicerEst >= est / 2 ? 'slicer' : 'estimate';
	return {
		ratio,
		sampleHours: actual,
		estHours: est,
		runs,
		basis,
		text: paceText(ratio, basis)
	};
}

const SOURCE: Record<string, string> = {
	manual: 'your entry',
	slicer: 'slicer',
	learned: 'your slice',
	profile: 'template profile',
	estimate: 'estimate'
};

export interface PlateTimeBadge {
	/** Headline: "≈ 9.4 h at your pace" or "~10.2 h". */
	main: string;
	/** Secondary: "slicer 10.2 h"; empty when there is no pace (the source is in `main`). */
	base: string;
	/** Multi-run plates: the total across runs. */
	total: string;
	/** Tooltip. */
	title: string;
	paced: boolean;
}

/** Per-run time badge text for a plate; null when the plate has no time. */
export function plateTimeBadge(plate: Plate, pace: Pace | null): PlateTimeBadge | null {
	if (!plate.estSeconds) return null;
	const src = SOURCE[plate.estSource ?? ''] ?? '';
	const rough = plate.estSource === 'estimate' && plate.estRough ? 'rough estimate' : src;
	const runs = plate.perPartRuns ? plate.runs * plate.parts.length : plate.runs;
	// the rims: the time is one print (one bed load), of which there are runs x parts
	const perRun = runs > 1 ? (plate.perPartRuns ? ' per print' : ' per run') : '';
	if (pace) {
		const adj = plate.estSeconds * pace.ratio;
		return {
			main: `≈ ${fmtH(adj)}${perRun} at your pace`,
			base: `${rough || 'plate'} ${fmtH(plate.estSeconds)}`,
			total: runs > 1 ? `${fmtH(adj * runs)} total` : '',
			title: `${rough || 'Plate'} time ${fmtH(plate.estSeconds)}; ${pace.text}`,
			paced: true
		};
	}
	return {
		main: `~${fmtH(plate.estSeconds)}${perRun}`,
		base:
			plate.estSource === 'estimate'
				? plate.estRough
					? '(rough estimate)'
					: '(estimate)'
				: plate.estSource === 'learned'
					? '(from your slice)'
					: '',
		total: runs > 1 ? `${fmtH(plate.estSeconds * runs)} total` : '',
		title: rough ? `Time from ${rough}` : 'Plate time',
		paced: false
	};
}
