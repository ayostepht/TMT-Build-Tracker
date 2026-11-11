/**
 * Filament and print-time accounting.
 *
 * A "unit" is one plate, except a perPartRuns plate (e.g. the wheel rim plate),
 * where each part is its own unit printed `plate.runs` times. Estimate per run:
 * slicer grams entered on the plate if any, else the BOM grams divided by runs.
 * Used: logged grams, or the estimate when the unit is printed with nothing
 * logged. A running print still counts as to print.
 */
import { fmtH } from './format.ts';
import { paceOf, type Pace } from './pace.ts';
import type { BuildView, PartDef, Plate, PrintRun } from './types.ts';

export interface Unit {
	plate: number; // 0 for parts that are on no plate
	key: string; // plate number as a string, or the part slug for perPartRuns / unplated units
	parts: PartDef[];
	role: string;
	runs: number;
}

export function units(view: BuildView): Unit[] {
	const bySlug = new Map(view.parts.map((p) => [p.slug, p]));
	const plated = new Set<string>();
	const out: Unit[] = [];
	for (const pl of [...view.plates].sort((a, b) => a.number - b.number)) {
		const parts = pl.parts.map((s) => bySlug.get(s)).filter((p): p is PartDef => !!p);
		if (!parts.length) continue;
		parts.forEach((p) => plated.add(p.slug));
		const runs = Math.max(1, pl.runs || 1);
		if (pl.perPartRuns) {
			for (const p of parts)
				out.push({ plate: pl.number, key: p.slug, parts: [p], role: p.role, runs });
		} else {
			out.push({ plate: pl.number, key: String(pl.number), parts, role: parts[0].role, runs });
		}
	}
	for (const p of view.parts) {
		if (!plated.has(p.slug)) out.push({ plate: 0, key: p.slug, parts: [p], role: p.role, runs: 1 });
	}
	return out;
}

export function plateByNumber(view: BuildView, n: number): Plate | undefined {
	return view.plates.find((p) => p.number === n);
}

const positive = (v: number | null | undefined): number | null =>
	typeof v === 'number' && v > 0 ? v : null;

/** Slicer grams per run for the unit, or null. */
export function slicerFor(view: BuildView, u: Unit): number | null {
	const pl = plateByNumber(view, u.plate);
	if (!pl) return null;
	return positive(pl.perPartRuns ? pl.slicerByPart[u.key] : pl.slicerGrams);
}

/** Positive entries of a plate's sliced-file grams, by role. */
const fileGrams = (pl: Plate): [string, number][] =>
	Object.entries(pl.filamentGrams ?? {}).filter(
		(e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0
	);

/**
 * Grams per run by role from a plate's sliced 3MF (`Plate.filamentGrams`), limited to the
 * roles of the plate's parts. A sliced file's slot -> role map can disagree with the design
 * (stray slots, a wrong slot order), so the parts' roles decide where the grams go; entries
 * for roles no part on the plate has are dropped. Null when nothing is left (no file data, or
 * no overlap): callers then fall back to the parts' own roles. Pure.
 */
export function plateFileRoleGrams(
	plate: Plate,
	partRoles: Iterable<string>
): Record<string, number> | null {
	const roles = new Set(partRoles);
	const kept = fileGrams(plate).filter(([r]) => roles.has(r));
	return kept.length ? Object.fromEntries(kept) : null;
}

/** Grams per run by role for a whole-plate unit (see plateFileRoleGrams); null for perPartRuns / no usable file data. */
function plateRoleGrams(view: BuildView, u: Unit): Record<string, number> | null {
	const pl = plateByNumber(view, u.plate);
	if (!pl || pl.perPartRuns) return null;
	return plateFileRoleGrams(
		pl,
		u.parts.map((p) => p.role)
	);
}

/** How a unit's grams split over filament roles: {role: 1} normally, grams-proportional for multi-filament plates. */
export function roleShares(view: BuildView, u: Unit): Record<string, number> {
	const fg = plateRoleGrams(view, u);
	if (!fg) return { [u.role]: 1 };
	const total = Object.values(fg).reduce((a, b) => a + b, 0);
	return Object.fromEntries(Object.entries(fg).map(([r, g]) => [r, g / total]));
}

export function estPerRun(view: BuildView, u: Unit): number {
	const s = slicerFor(view, u);
	if (s) return s;
	// The file's whole total stays the estimate: the plate still uses all of it, filtering
	// only changes which roles it belongs to.
	const pl = plateByNumber(view, u.plate);
	const file = pl && !pl.perPartRuns ? fileGrams(pl) : [];
	if (file.length) return file.reduce((a, [, g]) => a + g, 0);
	return u.parts.reduce((a, p) => a + (p.bomGrams || 0), 0) / u.runs;
}

export function estTotal(view: BuildView, u: Unit): number {
	return estPerRun(view, u) * u.runs;
}

export function unitDone(view: BuildView, u: Unit): boolean {
	return u.parts.every((p) => view.state[p.slug]?.status === 'Printed');
}

/** Plate-log runs that belong to the unit (perPartRuns units only see their own part's runs). */
export function unitEntries(view: BuildView, u: Unit): PrintRun[] {
	if (u.plate <= 0) return [];
	const pl = plateByNumber(view, u.plate);
	return view.runs.filter(
		(r) => r.plateNumber === u.plate && (pl?.perPartRuns ? r.partSlug === u.key : true)
	);
}

/** Successful whole-run wins counted toward `runs`; part-narrowed runs only count for perPartRuns units. */
export function unitWins(view: BuildView, u: Unit, extra: PrintRun[] = []): number {
	const pl = plateByNumber(view, u.plate);
	return [...unitEntries(view, u), ...extra.filter((r) => r.plateNumber === u.plate)].filter(
		(r) => r.result === 'Success' && (pl?.perPartRuns ? r.partSlug === u.key : !r.partSlug)
	).length;
}

function unitLoggedG(view: BuildView, u: Unit): number {
	const slugs = new Set(u.parts.map((p) => p.slug));
	const partLog = view.runs.filter(
		(r) => r.plateNumber == null && r.partSlug != null && slugs.has(r.partSlug)
	);
	return [...unitEntries(view, u), ...partLog].reduce((a, r) => a + (Number(r.grams) || 0), 0);
}

export function unitUsed(view: BuildView, u: Unit): number {
	const g = unitLoggedG(view, u);
	return g > 0 ? g : unitDone(view, u) ? estTotal(view, u) : 0;
}

export function unitRunsLeft(view: BuildView, u: Unit): number {
	if (unitDone(view, u)) return 0;
	if (u.runs === 1) return 1;
	return Math.max(1, u.runs - unitWins(view, u));
}

export function unitLeft(view: BuildView, u: Unit): number {
	return estPerRun(view, u) * unitRunsLeft(view, u);
}

export interface FilamentStat {
	role: string;
	used: number;
	need: number; // still to print
	total: number;
	unweighed: number; // unfinished units with no estimate at all
	haveGrams: number; // spools on hand * 1000
	short: boolean;
	shortByGrams: number;
}

export function filamentStats(view: BuildView): FilamentStat[] {
	const all = units(view);
	return view.filaments.map((f) => {
		const share = (u: Unit) => roleShares(view, u)[f.key] ?? 0;
		const us = all.filter((u) => share(u) > 0);
		const used = us.reduce((a, u) => a + unitUsed(view, u) * share(u), 0);
		const need = us.reduce((a, u) => a + unitLeft(view, u) * share(u), 0);
		const haveGrams = (Number(f.spools) || 0) * 1000;
		const spare = haveGrams - used - need;
		return {
			role: f.key,
			used,
			need,
			total: us.reduce((a, u) => a + estTotal(view, u) * share(u), 0),
			unweighed: us.filter((u) => !unitDone(view, u) && !estPerRun(view, u)).length,
			haveGrams,
			short: spare < 0,
			shortByGrams: Math.max(0, -spare)
		};
	});
}

export interface TimeStats {
	totalSec: number;
	leftSec: number;
	loggedHours: number;
	paceRatio: number | null; // actual / estimated, once >= 12 h of timed successful runs
	adjustedLeftSec: number | null;
	/** The full pace calibration (ratio, sample hours, text); null before enough timed runs. */
	pace: Pace | null;
	/** Some plate has a time (so the totals mean something). */
	known: boolean;
	/** Part of the total comes from our estimate (not slicer or MakeGood profile times). */
	estimated: boolean;
	/** The estimate includes a gram-based guess for parts that are on no MakeGood plate. */
	rough: boolean;
	/** Parts remain to be printed. */
	partsLeft: boolean;
	/** Part of the total comes from the build's print template ("from your slice"). */
	learned: boolean;
}

function plateTotalRuns(pl: Plate): number {
	return pl.perPartRuns ? pl.runs * pl.parts.length : pl.runs;
}

function plateRunsLeft(view: BuildView, pl: Plate): number {
	const state = (s: string) => view.state[s]?.status;
	const wins = (pred: (r: PrintRun) => boolean) =>
		view.runs.filter((r) => r.plateNumber === pl.number && r.result === 'Success' && pred(r))
			.length;
	if (pl.perPartRuns) {
		return pl.parts.reduce(
			(a, slug) =>
				state(slug) === 'Printed' ? a : a + Math.max(0, pl.runs - wins((r) => r.partSlug === slug)),
			0
		);
	}
	if (pl.parts.every((s) => state(s) === 'Printed')) return 0;
	return Math.max(1, pl.runs - wins((r) => !r.partSlug));
}

export function timeStats(view: BuildView): TimeStats {
	let totalSec = 0;
	let leftSec = 0;
	let estimated = false;
	let rough = false;
	let learned = false;
	for (const pl of view.plates) {
		const est = pl.estSeconds || 0;
		if (est && pl.estSource === 'learned') learned = true;
		totalSec += est * plateTotalRuns(pl);
		leftSec += est * plateRunsLeft(view, pl);
		if (est && pl.estSource === 'estimate') {
			estimated = true;
			if (pl.estRough) rough = true;
		}
	}
	let loggedHours = 0;
	for (const r of view.runs) loggedHours += Number(r.hours) || 0;
	const pace = paceOf(view);
	const paceRatio = pace ? pace.ratio : null;
	return {
		totalSec,
		leftSec,
		loggedHours,
		paceRatio,
		adjustedLeftSec: paceRatio ? leftSec * paceRatio : null,
		pace,
		known: totalSec > 0,
		estimated,
		rough,
		learned,
		partsLeft: view.parts.some((p) => view.state[p.slug]?.status !== 'Printed')
	};
}

export interface Progress {
	total: number;
	printed: number;
	printing: number;
	reprint: number;
	toPrint: number;
	pct: number; // printed / total * 100
}

export function overallProgress(view: BuildView): Progress {
	const count = (s: string) => view.parts.filter((p) => view.state[p.slug]?.status === s).length;
	const total = view.parts.length;
	const printed = count('Printed');
	return {
		total,
		printed,
		printing: count('Printing'),
		reprint: count('Reprint'),
		toPrint: count('To print'),
		pct: total ? (printed / total) * 100 : 0
	};
}

export const NO_TIME_HINT = 'no time estimate yet';

export interface TimeLeftText {
	text: string;
	hint: string | null;
	kind: 'known' | 'estimate' | 'unknown' | 'done';
}

/**
 * Text for the time left: "~12 h", or an em dash with a hint when no plate has a time but
 * parts remain (never "~0.0 h"). Labels our own estimate as an estimate.
 */
export function timeLeftText(t: TimeStats): TimeLeftText {
	if (!t.known) {
		return t.partsLeft
			? { text: '—', hint: NO_TIME_HINT, kind: 'unknown' }
			: { text: '0 h', hint: null, kind: 'done' };
	}
	const secs = t.adjustedLeftSec ?? t.leftSec;
	if (secs <= 0 && t.partsLeft) return { text: '—', hint: NO_TIME_HINT, kind: 'unknown' };
	return {
		text: `~${fmtH(secs)}`,
		hint: t.estimated
			? t.rough
				? 'rough estimate from MakeGood’s plate times'
				: 'estimate from MakeGood’s plate times'
			: t.learned
				? 'from your slice'
				: null,
		kind: t.estimated ? 'estimate' : 'known'
	};
}
