/**
 * Light shared pieces of the stats: date arithmetic, attempts (a split Partial is one print),
 * failure rates and the finish projection. Pure; imported by `stats.ts` and `kpis.ts`.
 */
import { timeStats } from './accounting.ts';
import { today } from './format.ts';
import type { BuildView, PrintRun } from './types.ts';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MS_DAY = 86_400_000;
export const MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

export function utc(date: string): number | null {
	if (!DATE_RE.test(date)) return null;
	const [y, m, d] = date.split('-').map(Number);
	const t = Date.UTC(y, m - 1, d);
	return new Date(t).toISOString().slice(0, 10) === date ? t : null;
}
export const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** `date` moved by whole days. */
export function addDays(date: string, days: number): string {
	const t = utc(date);
	return t === null ? date : iso(t + days * MS_DAY);
}

/** "Nov 10": a short, locale-free label for a date (empty string for a bad date). */
export function shortDate(date: string): string {
	if (utc(date) === null) return '';
	return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

export const hoursOf = (r: { hours: number | null }) => Math.max(0, Number(r.hours) || 0);
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const printerOf = (r: { printer: string | null }) => (r.printer ?? '').trim() || null;

/** A print as the maker sees it: a split Partial's two runs are one failed print. */
export interface Attempt {
	run: PrintRun;
	failed: boolean;
	/** False for the Success half of a split Partial (its Failed half stands for the print). */
	counts: boolean;
}

/** A Success and a Failed row that together are one split Partial (either may come first). */
export function isSplitPair(a: PrintRun, b: PrintRun): boolean {
	return (
		a.result === 'Success' &&
		b.result === 'Failed' &&
		a.plateNumber != null &&
		a.plateNumber === b.plateNumber &&
		!!a.partSlugs &&
		!!b.partSlugs &&
		!a.partSlug &&
		!b.partSlug &&
		a.date === b.date &&
		a.printer === b.printer &&
		a.note === b.note
	);
}

/**
 * Pairs are matched one to one whatever the row order (runs of one day are ordered by random id).
 * Each Failed row takes the first unpaired Success row that fits it.
 */
export function attempts(runs: PrintRun[]): Attempt[] {
	const kept = new Set<number>();
	runs.forEach((f) => {
		if (f.result !== 'Failed') return;
		const si = runs.findIndex((s, i) => !kept.has(i) && isSplitPair(s, f));
		if (si >= 0) kept.add(si);
	});
	return runs.map((run, i) => ({
		run,
		failed: run.result !== 'Success',
		counts: !kept.has(i)
	}));
}

export function plateLabel(number: number, name: string): string {
	return `P${number} ${name}`.trim();
}

// ---------- failure rates ----------

export interface FailureRate {
	runs: number;
	failed: number;
	/** `failed / runs`, 0 to 1 (0 with no runs). */
	rate: number;
}

export interface PlateFailure extends FailureRate {
	/** Plate number; null for the "Not on a plate" row. */
	plate: number | null;
	name: string;
}

export interface PrinterFailure extends FailureRate {
	/** Trimmed printer name; null for runs logged without one. */
	printer: string | null;
	hours: number;
	failedHours: number;
}

const rateOf = (runs: number, failed: number): FailureRate => ({
	runs,
	failed,
	rate: runs ? failed / runs : 0
});

/** Row label for part-level runs of a part that is on no plate. */
export const NO_PLATE_NAME = 'Not on a plate';

/**
 * Failed prints per plate and per printer, plus the build total. Plates and printers with no run
 * are left out; most failed first. A part-level run (no plate number) counts for its printer, the
 * total and the plate its part is on (the first one that holds it), or a "Not on a plate" row
 * (`plate: null`) when no plate holds it, so the plate rows add up to the total.
 */
export function failureRates(view: Pick<BuildView, 'runs' | 'plates'>): {
	total: FailureRate;
	byPlate: PlateFailure[];
	byPrinter: PrinterFailure[];
} {
	const att = attempts(view.runs);
	const names = new Map(view.plates.map((p) => [p.number, p.name]));
	const plateOfPart = new Map<string, number>();
	for (const p of view.plates)
		for (const slug of p.parts) if (!plateOfPart.has(slug)) plateOfPart.set(slug, p.number);
	const plates = new Map<number | null, { runs: number; failed: number }>();
	const printers = new Map<
		string | null,
		{ runs: number; failed: number; h: number; fh: number }
	>();
	let runs = 0;
	let failed = 0;
	for (const a of att) {
		const p = printers.get(printerOf(a.run)) ?? { runs: 0, failed: 0, h: 0, fh: 0 };
		printers.set(printerOf(a.run), p);
		const h = hoursOf(a.run);
		p.h += h;
		if (a.failed) p.fh += h;
		if (!a.counts) continue;
		runs++;
		p.runs++;
		if (a.failed) {
			failed++;
			p.failed++;
		}
		let key: number | null = a.run.plateNumber;
		if (key == null) {
			const slug = a.run.partSlug ?? a.run.partSlugs?.[0];
			if (slug === undefined) continue; // neither plate nor part: counts only in the total
			key = plateOfPart.get(slug) ?? null;
		}
		const pl = plates.get(key) ?? { runs: 0, failed: 0 };
		plates.set(key, pl);
		pl.runs++;
		if (a.failed) pl.failed++;
	}
	const byPlate = [...plates].map(([plate, v]) => ({
		plate,
		name: plate === null ? NO_PLATE_NAME : plateLabel(plate, names.get(plate) ?? ''),
		...rateOf(v.runs, v.failed)
	}));
	const byPrinter = [...printers].map(([printer, v]) => ({
		printer,
		hours: round1(v.h),
		failedHours: round1(v.fh),
		...rateOf(v.runs, v.failed)
	}));
	const worst = (a: FailureRate, b: FailureRate) => b.rate - a.rate || b.failed - a.failed;
	return {
		total: rateOf(runs, failed),
		byPlate: byPlate.sort((a, b) => worst(a, b) || (a.plate ?? Infinity) - (b.plate ?? Infinity)),
		byPrinter: byPrinter.sort((a, b) => worst(a, b) || b.hours - a.hours)
	};
}

// ---------- projected finish ----------

export const PROJECTION_DAYS = 28;
export const PROJECTION_MIN_RUNS = 3;

export type Projection =
	| { kind: 'not-enough'; runs: number }
	| { kind: 'done' }
	| { kind: 'no-estimate' }
	| {
			kind: 'projected';
			/** `YYYY-MM-DD` the last print should finish. */
			date: string;
			/** Hours still to print (at the build's pace once it has one). */
			hoursLeft: number;
			/** Printing hours per calendar day over the window. */
			hoursPerDay: number;
			/** Runs with hours in the window. */
			runs: number;
			/** Days the rate is over (the window, or fewer when the first run is more recent). */
			days: number;
	  };

/**
 * Finish date at the last 28 days' rate: logged hours (good and failed, both took the printer)
 * per calendar day, over the window or since its first run if that is more recent. Needs at least
 * 3 runs with hours in the window; otherwise `not-enough`. `no-estimate` when nothing left has a time.
 */
export function projectFinish(view: BuildView, now: Date = new Date()): Projection {
	const t = timeStats(view);
	if (!t.partsLeft) return { kind: 'done' };
	const todayStr = today(now);
	const from = addDays(todayStr, -(PROJECTION_DAYS - 1));
	const recent = view.runs.filter((r) => r.date >= from && r.date <= todayStr && hoursOf(r) > 0);
	if (recent.length < PROJECTION_MIN_RUNS) return { kind: 'not-enough', runs: recent.length };
	if (!(t.leftSec > 0)) return { kind: 'no-estimate' };
	const first = recent.reduce((m, r) => (r.date < m ? r.date : m), todayStr);
	const days = Math.max(1, Math.round(((utc(todayStr) ?? 0) - (utc(first) ?? 0)) / MS_DAY) + 1);
	const hours = recent.reduce((a, r) => a + hoursOf(r), 0);
	const hoursPerDay = hours / days;
	const hoursLeft = (t.adjustedLeftSec ?? t.leftSec) / 3600;
	return {
		kind: 'projected',
		date: addDays(todayStr, Math.ceil(hoursLeft / hoursPerDay)),
		hoursLeft: round1(hoursLeft),
		hoursPerDay: round2(hoursPerDay),
		runs: recent.length,
		days
	};
}
