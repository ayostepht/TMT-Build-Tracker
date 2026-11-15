/**
 * Filament and print-time accounting.
 *
 * A "unit" is one plate, except a perPartRuns plate (e.g. the wheel rim plate),
 * where each part is its own unit printed `plate.runs` times. Grams come from ONE place,
 * `partGrams` / `plateGrams` (typed > sliced file > your slice > MakeGood BOM, see below);
 * `estPerRun` delegates to them. Used: logged grams, plus the estimate for printed runs
 * that were logged without grams. A running print still counts as to print.
 */
import { fmtH } from './format.ts';
import { paceOf, type Pace } from './pace.ts';
import type { BuildView, GramsInfo, GramsSource, PartDef, Plate, PrintRun } from './types.ts';

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

// ---- Grams: one source order for parts, plates and units ---------------------------------------
//
// Part  (total for ALL copies): typed (`PartState.manualGrams`) > your slice (`partProfiles`,
//        grams per copy x the part's quantity) > MakeGood BOM (`PartDef.bomGrams` is already the
//        total for all copies; never multiply it by qty again).
// Plate (per run): typed plate grams > sliced file (`filamentGrams`, or the build's own slice on
//        arranged plates) > the sum of its parts. A typed plate total wins for that plate; the
//        parts still show their own value. A perPartRuns plate sums its parts, each of which
//        takes its own `slicerByPart` entry first (typed there > typed on the part > file).

const TRUST: Record<GramsSource, number> = { none: 0, bom: 1, slice: 2, file: 3, user: 4 };

/** The least trusted of the known sources ('none' entries are skipped; 'none' when there is nothing). */
export function weakestGramsSource(sources: GramsSource[]): GramsSource {
	return sources.reduce<GramsSource>(
		(a, s) => (s === 'none' ? a : a === 'none' || TRUST[s] < TRUST[a] ? s : a),
		'none'
	);
}

/** The grams of one part: see the order above. `perRun` divides by the plate's runs (1 when on no plate). */
export function partGrams(view: BuildView, slug: string): GramsInfo {
	const part =
		view.parts.find((p) => p.slug === slug) ?? view.allParts.find((p) => p.slug === slug);
	const none: GramsInfo = { perRun: 0, total: 0, source: 'none', approx: false, unknown: [slug] };
	if (!part) return none;
	const plate = view.plates.find((p) => p.parts.includes(slug));
	const runs = Math.max(1, plate?.runs || 1);
	const make = (total: number, source: GramsSource): GramsInfo => ({
		perRun: total / runs,
		total,
		source,
		approx: source === 'bom',
		unknown: []
	});
	const perRunOf = (g: number, source: GramsSource): GramsInfo => ({
		...make(g * runs, source),
		perRun: g
	});
	const typedHere = positive(view.state[slug]?.manualGrams);
	const bySlicer = plate?.perPartRuns ? positive(plate.slicerByPart[slug]) : null;
	if (bySlicer && plate?.gramsSource === 'user') return perRunOf(bySlicer, 'user');
	if (typedHere) return make(typedHere, 'user');
	if (bySlicer) return perRunOf(bySlicer, 'file');
	const learned = Object.values(view.partProfiles?.[slug]?.gramsByRole ?? {}).reduce(
		(a, g) => a + (g > 0 ? g : 0),
		0
	);
	if (learned > 0) return make(learned * Math.max(1, part.qty ?? 1), 'slice');
	const bom = positive(part.bomGrams);
	if (bom) return make(bom, 'bom');
	return none;
}

/**
 * The grams of one print of a plate (and of all its runs). A perPartRuns plate adds its parts: `perRun`
 * is one round of every part, `total` everything. `unknown` lists parts that have no weight when the
 * plate's number comes from its parts; a typed or file total leaves it empty (it covers them).
 */
export function plateGrams(view: BuildView, plate: Plate): GramsInfo {
	const runs = Math.max(1, plate.runs || 1);
	const slugs = plate.parts.filter((s) => view.parts.some((p) => p.slug === s));
	if (!plate.perPartRuns) {
		const typed = positive(plate.slicerGrams);
		if (typed)
			return {
				perRun: typed,
				total: typed * runs,
				source: plate.gramsSource === 'user' ? 'user' : 'file',
				approx: false,
				unknown: []
			};
		const file = fileGrams(plate).reduce((a, [, g]) => a + g, 0);
		if (file > 0)
			return {
				perRun: file,
				total: file * runs,
				source: plate.gramsSource === 'slice' ? 'slice' : 'file',
				approx: false,
				unknown: []
			};
	}
	const infos = slugs.map((s) => partGrams(view, s));
	const known = infos.filter((i) => i.source !== 'none');
	const unknown = infos.filter((i) => i.source === 'none').flatMap((i) => i.unknown);
	const total = known.reduce((a, i) => a + i.total, 0);
	const source = weakestGramsSource(known.map((i) => i.source));
	return {
		perRun: plate.perPartRuns ? known.reduce((a, i) => a + i.perRun, 0) : total / runs,
		total,
		source,
		approx: known.some((i) => i.approx) || unknown.length > 0,
		unknown
	};
}

/** Grams of one unit (a whole plate, one part of a perPartRuns plate, or a part on no plate). */
function unitGrams(view: BuildView, u: Unit): GramsInfo {
	const pl = plateByNumber(view, u.plate);
	if (pl && !pl.perPartRuns) return plateGrams(view, pl);
	return partGrams(view, u.parts[0].slug);
}

export function estPerRun(view: BuildView, u: Unit): number {
	return unitGrams(view, u).perRun;
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

function unitLogged(view: BuildView, u: Unit): PrintRun[] {
	const slugs = new Set(u.parts.map((p) => p.slug));
	const partLog = view.runs.filter(
		(r) => r.plateNumber == null && r.partSlug != null && slugs.has(r.partSlug)
	);
	return [...unitEntries(view, u), ...partLog];
}

/**
 * Grams used: every logged gram (failed prints used filament too), plus the estimate for each
 * run of a finished unit that no successful log with grams stands for (a Success logged without
 * grams, or a part marked Printed by hand).
 */
export function unitUsed(view: BuildView, u: Unit): number {
	const log = unitLogged(view, u);
	const logged = log.reduce((a, r) => a + (Number(r.grams) || 0), 0);
	if (!unitDone(view, u)) return logged;
	const measured = log.filter((r) => r.result === 'Success' && Number(r.grams) > 0).length;
	return logged + estPerRun(view, u) * Math.max(0, u.runs - measured);
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
	/** Parts of this role that are still to print and have no weight at all (left out of `need` and `total`). */
	unknownParts: string[];
	/** `unknownParts.length` (kept for existing readers). */
	unweighed: number;
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
		const unknownParts = [
			...new Set(
				all
					.filter((u) => !unitDone(view, u))
					.flatMap((u) => unitGrams(view, u).unknown)
					.filter(
						(s) =>
							view.state[s]?.status !== 'Printed' &&
							view.parts.find((p) => p.slug === s)?.role === f.key
					)
			)
		];
		const spare = haveGrams - used - need;
		return {
			role: f.key,
			used,
			need,
			total: us.reduce((a, u) => a + estTotal(view, u) * share(u), 0),
			unknownParts,
			unweighed: unknownParts.length,
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
