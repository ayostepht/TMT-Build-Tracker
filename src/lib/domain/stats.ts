/**
 * Stats for the charts: numbers only, no colours and no Svelte. A route maps the results to the
 * chart components' props (tones, short labels). Pure: no DB, no Node.
 *
 * Money rules shared with the rest of the app: a Success run is "good" (kept), a Failed run and
 * an older Partial row are "failed" (lost); a Partial logged with per-part results is stored as a
 * Success run plus a Failed run (see `splitPartial`), and counts as ONE failed print in the
 * failure rates. Dates are the local calendar dates the app stores (`YYYY-MM-DD`); all bucketing
 * is plain calendar arithmetic on those strings, so it does not depend on the server's timezone
 * (only `today(now)` reads the local clock, like the rest of the app). Weeks start on Monday.
 */
import { filamentStats, stockKg, timeStats } from './accounting.ts';
import { today } from './format.ts';
import { timedRun } from './pace.ts';
import type { BuildPhase, BuildView, PrintRun } from './types.ts';

// ---------- dates ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utc(date: string): number | null {
	if (!DATE_RE.test(date)) return null;
	const [y, m, d] = date.split('-').map(Number);
	const t = Date.UTC(y, m - 1, d);
	return new Date(t).toISOString().slice(0, 10) === date ? t : null;
}
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** `date` moved by whole days. */
export function addDays(date: string, days: number): string {
	const t = utc(date);
	return t === null ? date : iso(t + days * MS_DAY);
}

/** `date` moved back by whole calendar months (the day is kept, or clamped to the month's end). */
export function subMonths(date: string, months: number): string {
	const t = utc(date);
	if (t === null) return date;
	const d = new Date(t);
	const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1);
	const last = new Date(
		Date.UTC(new Date(first).getUTCFullYear(), new Date(first).getUTCMonth() + 1, 0)
	).getUTCDate();
	return iso(first + (Math.min(d.getUTCDate(), last) - 1) * MS_DAY);
}

export type StatsUnit = 'day' | 'week' | 'month';

/** First day of the period holding `date`: the day itself, its Monday, or the 1st of its month. */
export function periodStart(date: string, unit: StatsUnit): string {
	const t = utc(date);
	if (t === null || unit === 'day') return date;
	if (unit === 'month') return `${date.slice(0, 7)}-01`;
	const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
	return iso(t - dow * MS_DAY);
}

function nextPeriod(start: string, unit: StatsUnit): string {
	if (unit === 'day') return addDays(start, 1);
	if (unit === 'week') return addDays(start, 7);
	const [y, m] = start.split('-').map(Number);
	return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** "Nov 10": a short, locale-free label for a date (empty string for a bad date). */
export function shortDate(date: string): string {
	if (utc(date) === null) return '';
	return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

const MAX_PERIODS = 1100;

/** Every period start from `from` to `to` (inclusive), oldest first; at most `MAX_PERIODS` (the latest ones). */
export function periodStarts(from: string, to: string, unit: StatsUnit): string[] {
	if (utc(from) === null || utc(to) === null || from > to) return [];
	const out: string[] = [];
	for (let s = periodStart(from, unit); s <= to; s = nextPeriod(s, unit)) out.push(s);
	return out.length > MAX_PERIODS ? out.slice(out.length - MAX_PERIODS) : out;
}

/** Months a workspace page may ask for: a whole number from 1 to 24, 6 when missing or not a number. */
export function clampMonths(v: unknown): number {
	const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
	if (!Number.isFinite(n)) return 6;
	return Math.min(24, Math.max(1, Math.round(n)));
}

// ---------- runs ----------

const hoursOf = (r: { hours: number | null }) => Math.max(0, Number(r.hours) || 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const printerOf = (r: { printer: string | null }) => (r.printer ?? '').trim() || null;

/** A print as the maker sees it: a split Partial's two runs are one failed print. */
interface Attempt {
	run: PrintRun;
	failed: boolean;
	/** False for the Success half of a split Partial (its Failed half stands for the print). */
	counts: boolean;
}

function isSplitPair(a: PrintRun, b: PrintRun | undefined): boolean {
	return (
		!!b &&
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

function attempts(runs: PrintRun[]): Attempt[] {
	return runs.map((run, i) => ({
		run,
		failed: run.result !== 'Success',
		counts: !isSplitPair(run, runs[i + 1])
	}));
}

// ---------- hours per period ----------

export interface PeriodHours {
	/** Period start: the day, its Monday, or the 1st of the month (`YYYY-MM-DD`). */
	key: string;
	goodHours: number;
	failedHours: number;
}

/**
 * Printing hours per period between `from` and `to` (both inclusive, `YYYY-MM-DD`). Every period in
 * range is returned, empty ones as zeros. Failed runs and older Partial rows are failed hours.
 */
export function runsByPeriod(
	view: Pick<BuildView, 'runs'>,
	opts: { unit: StatsUnit; from: string; to: string }
): PeriodHours[] {
	return bucketHours(
		view.runs.map((r) => ({ date: r.date, hours: r.hours, good: r.result === 'Success' })),
		opts
	);
}

function bucketHours(
	runs: { date: string; hours: number | null; good: boolean }[],
	opts: { unit: StatsUnit; from: string; to: string }
): PeriodHours[] {
	const keys = periodStarts(opts.from, opts.to, opts.unit);
	const out = new Map(keys.map((key) => [key, { key, goodHours: 0, failedHours: 0 }]));
	// Runs cluster on few dates: work out each date's period once.
	const startOf = new Map<string, string>();
	for (const r of runs) {
		if (r.date < opts.from || r.date > opts.to) continue;
		let start = startOf.get(r.date);
		if (start === undefined) startOf.set(r.date, (start = periodStart(r.date, opts.unit)));
		const b = out.get(start);
		if (!b) continue;
		if (r.good) b.goodHours += hoursOf(r);
		else b.failedHours += hoursOf(r);
	}
	return keys.map((k) => {
		const b = out.get(k)!;
		return { key: k, goodHours: round1(b.goodHours), failedHours: round1(b.failedHours) };
	});
}

// ---------- plate times ----------

export interface PlateTime {
	plate: number;
	name: string;
	/** Runs the averages are over. */
	runs: number;
	/** Average logged hours per run. */
	actualHours: number;
	/** The plate's time per run (slicer, your slice, profile or estimate); null when it has none. */
	estHours: number | null;
	/** `actualHours - estHours`; null without an estimate. */
	deltaHours: number | null;
}

/**
 * Logged time per run against the plate's time, longest plates first. With a plate time only the
 * runs pace calibration trusts count (`timedRun`); a plate without one averages all its successful
 * whole-plate runs that have hours, with `estHours` null.
 */
export function plateTimes(view: BuildView): PlateTime[] {
	const out: PlateTime[] = [];
	for (const pl of view.plates) {
		const mine = view.runs.filter((r) => r.plateNumber === pl.number);
		let actual = 0;
		let est = 0;
		let n = 0;
		if (pl.estSeconds) {
			for (const r of mine) {
				const t = timedRun(view, r);
				if (!t) continue;
				actual += t.actual;
				est += t.est;
				n++;
			}
		} else {
			for (const r of mine) {
				const h = hoursOf(r);
				if (r.result !== 'Success' || !(h > 0)) continue;
				if (!pl.perPartRuns && r.partSlugs && r.partSlugs.length < pl.parts.length) continue;
				actual += h;
				n++;
			}
		}
		if (!n) continue;
		const estHours = pl.estSeconds ? est / n : null;
		out.push({
			plate: pl.number,
			name: plateLabel(pl.number, pl.name),
			runs: n,
			actualHours: round2(actual / n),
			estHours: estHours === null ? null : round2(estHours),
			deltaHours: estHours === null ? null : round2(actual / n - estHours)
		});
	}
	return out.sort(
		(a, b) => (b.estHours ?? b.actualHours) - (a.estHours ?? a.actualHours) || a.plate - b.plate
	);
}

function plateLabel(number: number, name: string): string {
	return `P${number} ${name}`.trim();
}

// ---------- filament ----------

/** A filament hex for an inline style: only `#rrggbb`, else undefined. */
export function safeSwatch(hex: string | null | undefined): string | undefined {
	return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex : undefined;
}

export interface FilamentUse {
	role: string;
	name: string;
	material: string;
	hex: string;
	keptG: number;
	lostG: number;
	/** Still to print. */
	toPrintG: number;
	/** Stock on hand at the start plus spools added, in grams. */
	haveG: number;
	/** Grams missing when what is used plus what is left exceeds the stock; 0 otherwise. */
	shortG: number;
}

/** Filament per color slot: kept, lost, still to print and on hand, in whole grams. */
export function filamentBreakdown(view: BuildView): FilamentUse[] {
	const byRole = new Map(filamentStats(view).map((s) => [s.role, s]));
	return view.filaments.map((f) => {
		const s = byRole.get(f.key);
		return {
			role: f.key,
			name: f.name,
			material: f.material,
			hex: f.hex,
			keptG: Math.round(s?.keptG ?? 0),
			lostG: Math.round(s?.lostG ?? 0),
			toPrintG: Math.round(s?.need ?? 0),
			haveG: Math.round(stockKg(f) * 1000),
			shortG: Math.round(s?.shortByGrams ?? 0)
		};
	});
}

// ---------- failure rates ----------

export interface FailureRate {
	runs: number;
	failed: number;
	/** `failed / runs`, 0 to 1 (0 with no runs). */
	rate: number;
}

export interface PlateFailure extends FailureRate {
	plate: number;
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

/**
 * Failed prints per plate and per printer, plus the build total. Plates and printers with no run
 * are left out; most failed first. A part-only log (no plate) counts for its printer and the total.
 */
export function failureRates(view: Pick<BuildView, 'runs' | 'plates'>): {
	total: FailureRate;
	byPlate: PlateFailure[];
	byPrinter: PrinterFailure[];
} {
	const att = attempts(view.runs);
	const names = new Map(view.plates.map((p) => [p.number, p.name]));
	const plates = new Map<number, { runs: number; failed: number }>();
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
		if (a.run.plateNumber != null) {
			const pl = plates.get(a.run.plateNumber) ?? { runs: 0, failed: 0 };
			plates.set(a.run.plateNumber, pl);
			pl.runs++;
			if (a.failed) pl.failed++;
		}
	}
	const byPlate = [...plates].map(([plate, v]) => ({
		plate,
		name: plateLabel(plate, names.get(plate) ?? ''),
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
		byPlate: byPlate.sort((a, b) => worst(a, b) || a.plate - b.plate),
		byPrinter: byPrinter.sort((a, b) => worst(a, b) || b.hours - a.hours)
	};
}

// ---------- progress ----------

export interface ProgressPoint {
	/** `YYYY-MM-DD`. */
	x: string;
	y: number;
}

export interface ProgressSeries {
	/** Plates finished over time (a plate is done when all its parts are printed), cumulative. */
	points: ProgressPoint[];
	/** Parts printed over time, cumulative. */
	partPoints: ProgressPoint[];
	platesTotal: number;
	partsTotal: number;
	/** Failed prints on a plate, on the date they were logged; every `x` is also a point of `points`. */
	markers: { x: string; label: string; tone: 'bad' }[];
}

function cumulative(start: string, dates: string[], extra: string[]): ProgressPoint[] {
	const count = new Map<string, number>();
	for (const d of dates) count.set(d, (count.get(d) ?? 0) + 1);
	const days = [...new Set([...count.keys(), ...extra])].sort();
	const first = days[0] !== undefined && days[0] < start ? days[0] : start;
	const out: ProgressPoint[] = [];
	let y = 0;
	if (first !== days[0]) out.push({ x: first, y: 0 });
	for (const d of days) {
		y += count.get(d) ?? 0;
		out.push({ x: d, y });
	}
	return out;
}

/**
 * Plates (and parts) done over time. A part's date is its `printedOn`, else the date of its
 * plate's last successful run, else the day its state last changed. The series starts at the
 * build's creation day with 0.
 */
export function progressSeries(view: BuildView): ProgressSeries {
	const partDate = (slug: string): string => {
		const st = view.state[slug];
		if (st.printedOn && DATE_RE.test(st.printedOn)) return st.printedOn;
		const pl = view.plates.find((p) => p.parts.includes(slug));
		const wins = view.runs
			.filter((r) => r.result === 'Success' && r.plateNumber === pl?.number)
			.map((r) => r.date)
			.sort();
		return wins[wins.length - 1] ?? st.updatedAt.slice(0, 10);
	};
	const printed = view.parts.filter((p) => view.state[p.slug]?.status === 'Printed');
	const partDates = printed.map((p) => partDate(p.slug));
	const plateDates: string[] = [];
	for (const pl of view.plates) {
		if (!pl.parts.length || !pl.parts.every((s) => view.state[s]?.status === 'Printed')) continue;
		plateDates.push(pl.parts.map(partDate).sort().pop()!);
	}
	const failed = attempts(view.runs).filter(
		(a) => a.counts && a.failed && a.run.plateNumber != null
	);
	const markers = failed.map((a) => ({
		x: a.run.date,
		label: `${plateLabel(a.run.plateNumber!, view.plates.find((p) => p.number === a.run.plateNumber)?.name ?? '')} failed`,
		tone: 'bad' as const
	}));
	const start = view.build.createdAt.slice(0, 10);
	const mx = markers.map((m) => m.x);
	return {
		points: cumulative(start, plateDates, mx),
		partPoints: cumulative(start, partDates, []),
		platesTotal: view.plates.filter((p) => p.parts.length).length,
		partsTotal: view.parts.length,
		markers
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

// ---------- summaries and the workspace ----------

/** One logged run, reduced to what the workspace page needs. */
export interface SummaryRun {
	date: string;
	hours: number;
	good: boolean;
	printer: string | null;
	plate: number | null;
	/** Counts as a print (false for the Success half of a split Partial). */
	counts: boolean;
}

export interface SummaryFilament {
	name: string;
	material: string;
	hex: string;
	keptG: number;
	lostG: number;
	/** Stock bought (starting spools plus added), in kg. */
	stockKg: number;
}

/**
 * A build reduced for the workspace page. No personal data: no user names or emails, no recipient
 * or hospital, no notes (the build name is the maker's own label for it).
 */
export interface BuildStatsSummary {
	id: string;
	name: string;
	phase: BuildPhase;
	/** Handoff date; a build counts as finished once it has one. */
	handedOffOn: string | null;
	/** `YYYY-MM-DD` of creation (UTC day). */
	createdOn: string;
	/** Key for the plate that tells the same plate apart across builds (the kit's plate number, or this build's own). */
	plateKeyPrefix: string;
	partsTotal: number;
	partsPrinted: number;
	keptHours: number;
	lostHours: number;
	filaments: SummaryFilament[];
	/** Plate names by number, for labels. */
	plateNames: Record<number, string>;
	runs: SummaryRun[];
}

export function buildStatsSummary(view: BuildView): BuildStatsSummary {
	const t = timeStats(view);
	const plateSource = new Map(view.plates.map((p) => [p.number, p.source]));
	const shared = (n: number) => {
		const s = plateSource.get(n) ?? '';
		return s === 'template' || s.startsWith('layout:');
	};
	const att = attempts(view.runs);
	const plateNames: Record<number, string> = {};
	for (const p of view.plates) plateNames[p.number] = p.name;
	return {
		id: view.build.id,
		name: view.build.name,
		phase: view.build.phase,
		handedOffOn: view.handoff?.handedOffOn ?? null,
		createdOn: view.build.createdAt.slice(0, 10),
		plateKeyPrefix: `${view.build.templateId}#`,
		partsTotal: view.parts.length,
		partsPrinted: view.parts.filter((p) => view.state[p.slug]?.status === 'Printed').length,
		keptHours: round1(t.keptHours),
		lostHours: round1(t.lostHours),
		filaments: filamentBreakdown(view).map((f) => ({
			name: f.name,
			material: f.material,
			hex: f.hex,
			keptG: f.keptG,
			lostG: f.lostG,
			stockKg: stockKg(view.filaments.find((x) => x.key === f.role)!)
		})),
		plateNames,
		runs: att.map((a) => ({
			date: a.run.date,
			hours: hoursOf(a.run),
			good: !a.failed,
			printer: printerOf(a.run),
			plate: a.run.plateNumber != null && shared(a.run.plateNumber) ? a.run.plateNumber : null,
			counts: a.counts
		}))
	};
}

export interface WorkspaceBuildRow {
	id: string;
	name: string;
	phase: BuildPhase;
	/** Finished = handed off. */
	finished: boolean;
	handedOffOn: string | null;
	hours: number;
	/** Filament used, kg. */
	kg: number;
	/** Share of the hours that were failed, 0 to 1. */
	lostShare: number;
	/** Days with a print logged. */
	days: number;
	partsPrinted: number;
	partsTotal: number;
}

export interface WorkspaceStats {
	months: number;
	/** The window, `YYYY-MM-DD`. */
	from: string;
	to: string;
	kpis: {
		builds: { total: number; finished: number; inProgress: number };
		hours: { total: number; good: number; lost: number; lostShare: number; printDays: number };
		filament: { keptKg: number; lostKg: number; stockKg: number };
		/** Averages over finished builds; null until one has hours. */
		perChair: { hours: number; kg: number; builds: number } | null;
	};
	weekly: PeriodHours[];
	printers: {
		printer: string | null;
		hours: number;
		failedHours: number;
		runs: number;
		failed: number;
		rate: number;
	}[];
	topFilaments: { name: string; material: string; hex: string; keptG: number; lostG: number }[];
	failingPlates: { key: string; label: string; runs: number; failed: number; rate: number }[];
	builds: WorkspaceBuildRow[];
}

export const MIN_PLATE_RUNS = 3;
const TOP_FILAMENTS = 8;
const TOP_PLATES = 8;

/**
 * The workspace page: hours, printers and failing plates from runs dated in the last `months`
 * months; filaments, the builds table and the per-chair averages from the builds that were active
 * in that window (a run in it, or created or handed off in it) with their all-time totals.
 */
export function workspaceStats(
	summaries: BuildStatsSummary[],
	opts: { months?: number; now?: Date } = {}
): WorkspaceStats {
	const months = clampMonths(opts.months);
	const to = today(opts.now ?? new Date());
	const from = subMonths(to, months);
	const inWin = (d: string | null) => !!d && d >= from && d <= to;

	const winRuns: { run: SummaryRun; build: BuildStatsSummary }[] = [];
	for (const b of summaries)
		for (const run of b.runs) if (inWin(run.date)) winRuns.push({ run, build: b });
	const active = summaries.filter(
		(b) => b.runs.some((r) => inWin(r.date)) || inWin(b.createdOn) || inWin(b.handedOffOn)
	);

	let good = 0;
	let lost = 0;
	const days = new Set<string>();
	const printers = new Map<string | null, WorkspaceStats['printers'][number]>();
	const plates = new Map<string, { label: string; runs: number; failed: number }>();
	for (const { run, build } of winRuns) {
		if (run.good) good += run.hours;
		else lost += run.hours;
		if (run.hours > 0) days.add(run.date);
		const p = printers.get(run.printer) ?? {
			printer: run.printer,
			hours: 0,
			failedHours: 0,
			runs: 0,
			failed: 0,
			rate: 0
		};
		printers.set(run.printer, p);
		p.hours += run.hours;
		if (!run.good) p.failedHours += run.hours;
		if (!run.counts) continue;
		p.runs++;
		if (!run.good) p.failed++;
		if (run.plate != null) {
			const key = `${build.plateKeyPrefix}${run.plate}`;
			const pl = plates.get(key) ?? {
				label: `P${run.plate} ${build.plateNames[run.plate] ?? ''}`.trim(),
				runs: 0,
				failed: 0
			};
			plates.set(key, pl);
			pl.runs++;
			if (!run.good) pl.failed++;
		}
	}

	const fil = new Map<string, WorkspaceStats['topFilaments'][number]>();
	let keptG = 0;
	let lostG = 0;
	let stock = 0;
	for (const b of active)
		for (const f of b.filaments) {
			keptG += f.keptG;
			lostG += f.lostG;
			stock += f.stockKg;
			const key = `${f.name}|${f.material}`.toLowerCase();
			const cur = fil.get(key) ?? {
				name: f.name,
				material: f.material,
				hex: f.hex,
				keptG: 0,
				lostG: 0
			};
			fil.set(key, cur);
			cur.keptG += f.keptG;
			cur.lostG += f.lostG;
		}

	const rows: WorkspaceBuildRow[] = active.map((b) => {
		const hours = b.keptHours + b.lostHours;
		const g = b.filaments.reduce((a, f) => a + f.keptG + f.lostG, 0);
		return {
			id: b.id,
			name: b.name,
			phase: b.phase,
			finished: !!b.handedOffOn,
			handedOffOn: b.handedOffOn,
			hours: round1(hours),
			kg: round1(g / 1000),
			lostShare: hours ? b.lostHours / hours : 0,
			days: new Set(b.runs.filter((r) => r.hours > 0).map((r) => r.date)).size,
			partsPrinted: b.partsPrinted,
			partsTotal: b.partsTotal
		};
	});
	const finishedAll = summaries.filter((b) => b.handedOffOn && b.keptHours + b.lostHours > 0);
	const perChair = finishedAll.length
		? {
				builds: finishedAll.length,
				hours: round1(
					finishedAll.reduce((a, b) => a + b.keptHours + b.lostHours, 0) / finishedAll.length
				),
				kg: round1(
					finishedAll.reduce(
						(a, b) => a + b.filaments.reduce((s, f) => s + f.keptG + f.lostG, 0),
						0
					) /
						finishedAll.length /
						1000
				)
			}
		: null;
	const finished = rows.filter((r) => r.finished).length;
	const total = good + lost;
	return {
		months,
		from,
		to,
		kpis: {
			builds: { total: rows.length, finished, inProgress: rows.length - finished },
			hours: {
				total: round1(total),
				good: round1(good),
				lost: round1(lost),
				lostShare: total ? lost / total : 0,
				printDays: days.size
			},
			filament: {
				keptKg: round1(keptG / 1000),
				lostKg: round1(lostG / 1000),
				stockKg: round1(stock)
			},
			perChair
		},
		weekly: bucketHours(
			winRuns.map(({ run }) => run),
			{ unit: 'week', from, to }
		),
		printers: [...printers.values()]
			.map((p) => ({
				...p,
				hours: round1(p.hours),
				failedHours: round1(p.failedHours),
				rate: p.runs ? p.failed / p.runs : 0
			}))
			.sort((a, b) => b.hours - a.hours),
		topFilaments: [...fil.values()]
			.filter((f) => f.keptG + f.lostG > 0)
			.sort((a, b) => b.keptG + b.lostG - (a.keptG + a.lostG))
			.slice(0, TOP_FILAMENTS),
		failingPlates: [...plates]
			.filter(([, p]) => p.runs >= MIN_PLATE_RUNS && p.failed > 0)
			.map(([key, p]) => ({ key, ...p, rate: p.failed / p.runs }))
			.sort((a, b) => b.rate - a.rate || b.failed - a.failed)
			.slice(0, TOP_PLATES),
		builds: rows.sort(
			(a, b) =>
				Number(a.finished) - Number(b.finished) || b.hours - a.hours || a.name.localeCompare(b.name)
		)
	};
}
