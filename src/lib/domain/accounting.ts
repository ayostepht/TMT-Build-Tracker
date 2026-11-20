/**
 * Filament and print-time accounting.
 *
 * A "unit" is one plate, except a perPartRuns plate (e.g. the wheel rim plate),
 * where each part is its own unit printed `plate.runs` times. Grams come from ONE place,
 * `partGrams` / `plateGrams` (typed > sliced file > your slice > MakeGood BOM, see below);
 * `estPerRun` delegates to them. Used: logged grams, plus the estimate for printed runs
 * that were logged without grams, split into kept (successful runs and those estimates) and
 * lost (failed runs, and older Partial rows). A running print still counts as to print.
 */
import { runTargets } from './actions.ts';
import { fmtH } from './format.ts';
import { paceOf, type Pace } from './pace.ts';
import { haveGramsOf, isDeductibleRun, isPreLinkRun, isSpoolmanLinked } from './spoolman.ts';
import type {
	BuildView,
	FilamentRole,
	GramsInfo,
	GramsSource,
	PartDef,
	Plate,
	PrintRun,
	PrintRunInput
} from './types.ts';

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

/**
 * Relative weights of parts for splitting a print between them (grams, hours): each part's
 * own weight for all copies (`partGrams`); a part without a weight takes the average of the
 * known ones (1 when none is known), so every part still gets a share. Pure.
 */
export function partWeights(view: BuildView, slugs: string[]): Record<string, number> {
	const w = slugs.map((s) => partGrams(view, s).total);
	const known = w.filter((x) => x > 0);
	const fill = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
	return Object.fromEntries(slugs.map((s, i) => [s, w[i] > 0 ? w[i] : fill]));
}

/** The share (0 to 1) of `subset` in the weight of `all` (see `partWeights`). */
export function weightShare(view: BuildView, all: string[], subset: string[]): number {
	const w = partWeights(view, all);
	const total = all.reduce((a, s) => a + w[s], 0);
	if (!(total > 0)) return 0;
	const mine = new Set(subset);
	return all.filter((s) => mine.has(s)).reduce((a, s) => a + w[s], 0) / total;
}

type RunLike = Pick<
	PrintRunInput,
	| 'plateNumber'
	| 'partSlug'
	| 'partSlugs'
	| 'grams'
	| 'date'
	| 'result'
	| 'hours'
	| 'printer'
	| 'note'
>;

/** Unrounded weights by role for the parts a run covers (the file's roles for a whole plate). */
function runRoleWeights(view: BuildView, run: RunLike): Record<string, number> {
	const slugs = runTargets(view, run as PrintRun | PrintRunInput).filter((s) => view.state[s]);
	const roleOf = (s: string) => view.allParts.find((p) => p.slug === s)?.role;
	const plate =
		run.plateNumber == null ? null : view.plates.find((p) => p.number === run.plateNumber);
	const wholePlate = plate && slugs.length === plate.parts.length;
	// The parts' roles decide which roles the file's grams go to (see plateFileRoleGrams).
	const fileWeights =
		wholePlate && plate
			? plateFileRoleGrams(
					plate,
					plate.parts.flatMap((s) => (view.state[s] ? [roleOf(s) ?? ''] : []))
				)
			: null;
	if (fileWeights) return fileWeights;
	const weights: Record<string, number> = {};
	for (const s of slugs) {
		const role = roleOf(s);
		if (!role) continue;
		// The part's own weight for all its copies (partGrams); 1 when unknown so it still gets a share.
		weights[role] = (weights[role] ?? 0) + (partGrams(view, s).total || 1);
	}
	return weights;
}

/**
 * Split the grams of a logged run across filament roles (to deduct from linked spools). A whole
 * plate follows its file's grams per role; otherwise the parts' weights by role. Rounded to 0.1 g. Pure.
 */
export function runRoleGrams(view: BuildView, run: RunLike): Record<string, number> {
	const grams = run.grams ?? 0;
	if (!(grams > 0)) return {};
	const weights = runRoleWeights(view, run);
	const total = Object.values(weights).reduce((a, b) => a + b, 0);
	if (!(total > 0)) return {};
	return Object.fromEntries(
		Object.entries(weights)
			.filter(([, w]) => w > 0)
			.map(([k, w]) => [k, Math.round(((grams * w) / total) * 10) / 10])
	);
}

/**
 * Grams of logged runs that land on one filament role, split by whether they were logged before
 * the slot was linked to Spoolman (`preG`, never deducted) or after (`postG`, deducted when the
 * workspace keeps Spoolman up to date). Old Partial rows and runs without grams count in
 * neither, like the deduction code. `linkedAt` null: everything is `postG`. Pure.
 */
export function linkedRunGrams(
	view: BuildView,
	role: string,
	linkedAt: number | null | undefined
): { preG: number; postG: number } {
	let preG = 0;
	let postG = 0;
	for (const r of view.runs) {
		if (!isDeductibleRun(r)) continue;
		const g = runRoleGrams(view, r)[role] ?? 0;
		if (isPreLinkRun(r, linkedAt)) preG += g;
		else postG += g;
	}
	return { preG: Math.round(preG * 10) / 10, postG: Math.round(postG * 10) / 10 };
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

/**
 * The share (0 to 1) of one print of a plate that `slugs` make up, by estimated grams
 * (`weightShare`). 1 for a perPartRuns plate (its parts print one by one), for the whole plate, and
 * for a selection with nothing on the plate. Used when only some parts of a plate are on the printer
 * (or logged) together, e.g. the straps picked off a plate that is printed in two goes.
 */
export function subsetShare(view: BuildView, plate: Plate, slugs: readonly string[]): number {
	if (plate.perPartRuns) return 1;
	const all = plate.parts.filter((s) => view.parts.some((p) => p.slug === s));
	const mine = all.filter((s) => slugs.includes(s));
	if (!mine.length || mine.length >= all.length) return 1;
	return weightShare(view, all, mine);
}

/** `plateGrams` for the part of the plate that is printed together: scaled by `subsetShare`. */
export function printGrams(view: BuildView, plate: Plate, slugs: readonly string[]): GramsInfo {
	const g = plateGrams(view, plate);
	const share = subsetShare(view, plate, slugs);
	return share === 1 ? g : { ...g, perRun: g.perRun * share, total: g.total * share };
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

export interface Use {
	/** Grams that ended up in printed parts: successful runs, plus the estimate for done runs no Success log covers. */
	kept: number;
	/** Grams of prints that did not make parts: failed runs and older Partial rows. */
	lost: number;
}

/**
 * Grams used by a unit, as kept and lost. Every logged gram counts (failed prints used filament
 * too): Success runs are kept, Failed and older Partial rows are lost. A finished unit also keeps
 * the estimate for each run that no successful log with grams stands for (a Success logged
 * without grams, or a part marked Printed by hand).
 */
export function unitUse(view: BuildView, u: Unit): Use {
	const log = unitLogged(view, u);
	let kept = 0;
	let lost = 0;
	for (const r of log) {
		const g = Number(r.grams) || 0;
		if (r.result === 'Success') kept += g;
		else lost += g;
	}
	if (unitDone(view, u)) {
		const measured = log.filter((r) => r.result === 'Success' && Number(r.grams) > 0).length;
		kept += estPerRun(view, u) * Math.max(0, u.runs - measured);
	}
	return { kept, lost };
}

/** Grams used: kept plus lost. */
export function unitUsed(view: BuildView, u: Unit): number {
	const { kept, lost } = unitUse(view, u);
	return kept + lost;
}

/**
 * `unitUse` by filament role. A whole-plate run follows the unit's role shares; a run of some of
 * the plate's parts (a Partial's two halves) follows those parts' own roles.
 */
export function unitUseByRole(view: BuildView, u: Unit): Record<string, Use> {
	const out: Record<string, Use> = {};
	const add = (role: string, kept: number, lost: number) => {
		const cur = (out[role] ??= { kept: 0, lost: 0 });
		cur.kept += kept;
		cur.lost += lost;
	};
	const shares = roleShares(view, u);
	const pl = plateByNumber(view, u.plate);
	const log = unitLogged(view, u);
	for (const r of log) {
		const g = Number(r.grams) || 0;
		if (!g) continue;
		const subset =
			!!pl &&
			!pl.perPartRuns &&
			r.plateNumber === pl.number &&
			!r.partSlug &&
			runTargets(view, r).length < pl.parts.length;
		let by = subset ? runRoleWeights(view, r) : shares;
		let total = Object.values(by).reduce((a, b) => a + b, 0);
		if (!(total > 0)) {
			by = shares;
			total = 1;
		}
		for (const [role, w] of Object.entries(by)) {
			const part = (g * w) / total;
			add(role, r.result === 'Success' ? part : 0, r.result === 'Success' ? 0 : part);
		}
	}
	if (unitDone(view, u)) {
		const measured = log.filter((r) => r.result === 'Success' && Number(r.grams) > 0).length;
		const extra = estPerRun(view, u) * Math.max(0, u.runs - measured);
		if (extra > 0) for (const [role, w] of Object.entries(shares)) add(role, extra * w, 0);
	}
	return out;
}

/**
 * Share of a single-run plate that is still to print: after a Partial the printed parts are
 * done, so only the unprinted parts' weight counts. 1 for multi-run, per-part and untouched units.
 */
function unprintedShare(view: BuildView, u: Unit): number {
	if (u.runs !== 1 || u.parts.length < 2) return 1;
	const pl = plateByNumber(view, u.plate);
	if (!pl || pl.perPartRuns) return 1;
	const left = u.parts.filter((p) => view.state[p.slug]?.status !== 'Printed').map((p) => p.slug);
	if (left.length === 0 || left.length === u.parts.length) return 1;
	return weightShare(
		view,
		u.parts.map((p) => p.slug),
		left
	);
}

export function unitRunsLeft(view: BuildView, u: Unit): number {
	if (unitDone(view, u)) return 0;
	if (u.runs === 1) return 1;
	return Math.max(1, u.runs - unitWins(view, u));
}

export function unitLeft(view: BuildView, u: Unit): number {
	return estPerRun(view, u) * unitRunsLeft(view, u) * unprintedShare(view, u);
}

/** Stock on hand in kg: the starting spools plus every spool added since (2 decimals). */
export function stockKg(f: Pick<FilamentRole, 'spools' | 'spoolAdds'>): number {
	const adds = (f.spoolAdds ?? []).reduce((a, x) => a + (Number(x.kg) || 0), 0);
	return Math.round(((Number(f.spools) || 0) + adds) * 100) / 100;
}

export interface FilamentStat {
	role: string;
	/** Everything printed so far: `keptG + lostG`. */
	used: number;
	/** Part of `used` that ended up in printed parts. */
	keptG: number;
	/** Part of `used` lost to failed prints (and older Partial logs). */
	lostG: number;
	need: number; // still to print
	total: number;
	/** Parts of this role that are still to print and have no weight at all (left out of `need` and `total`). */
	unknownParts: string[];
	/** `unknownParts.length` (kept for existing readers). */
	unweighed: number;
	haveGrams: number; // stock on hand (`stockKg`) * 1000
	/**
	 * Spare in grams: `haveGrams - usedForSpare - need`. Use this instead of subtracting `used`
	 * yourself, because a slot linked to Spoolman takes its stock from Spoolman (see `haveGramsOf`).
	 */
	spareG: number;
	/** The prints subtracted in `spareG` (equals `used` unless the slot is linked to Spoolman). */
	usedForSpare: number;
	/** Where `haveGrams` comes from: the app's spools, Spoolman's weight, or unknown (linked, never fetched). */
	haveSource: 'app' | 'spoolman' | 'unknown';
	/** The starting spools (kg). */
	startKg: number;
	/** Spools added since the start (kg). */
	addedKg: number;
	short: boolean;
	shortByGrams: number;
}

export function filamentStats(view: BuildView): FilamentStat[] {
	const all = units(view);
	return view.filaments.map((f) => {
		const share = (u: Unit) => roleShares(view, u)[f.key] ?? 0;
		const us = all.filter((u) => share(u) > 0);
		let keptG = 0;
		let lostG = 0;
		for (const u of all) {
			const use = unitUseByRole(view, u)[f.key];
			if (use) {
				keptG += use.kept;
				lostG += use.lost;
			}
		}
		const used = keptG + lostG;
		const need = us.reduce((a, u) => a + unitLeft(view, u) * share(u), 0);
		const sm = f.spoolman;
		const linkedRuns = isSpoolmanLinked(sm)
			? linkedRunGrams(view, f.key, sm!.linkedAt)
			: { preG: 0, postG: used };
		const have = haveGramsOf({
			appStockG: stockKg(f) * 1000,
			usedG: used,
			postLinkUsedG: linkedRuns.postG,
			spoolman: sm
		});
		const haveGrams = have.haveGrams;
		const startKg = Number(f.spools) || 0;
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
		const spare = haveGrams - have.usedGrams - need;
		return {
			role: f.key,
			used,
			keptG,
			lostG,
			need,
			total: us.reduce((a, u) => a + estTotal(view, u) * share(u), 0),
			unknownParts,
			unweighed: unknownParts.length,
			haveGrams,
			spareG: spare,
			usedForSpare: have.usedGrams,
			haveSource: have.source,
			startKg,
			addedKg: Math.round((stockKg(f) - startKg) * 100) / 100,
			short: have.source !== 'unknown' && spare < 0,
			shortByGrams: have.source === 'unknown' ? 0 : Math.max(0, -spare)
		};
	});
}

export interface TimeStats {
	totalSec: number;
	leftSec: number;
	loggedHours: number;
	/** Part of `loggedHours` in successful runs. */
	keptHours: number;
	/** Part of `loggedHours` in failed runs (and older Partial logs). */
	lostHours: number;
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
	// After a Partial on a single-run plate only the unprinted parts' share is still to print.
	if (pl.runs <= 1 && pl.parts.some((s) => state(s) === 'Printed')) {
		return weightShare(
			view,
			pl.parts,
			pl.parts.filter((s) => state(s) !== 'Printed')
		);
	}
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
	let keptHours = 0;
	let lostHours = 0;
	for (const r of view.runs) {
		const h = Number(r.hours) || 0;
		if (r.result === 'Success') keptHours += h;
		else lostHours += h;
	}
	const loggedHours = keptHours + lostHours;
	const pace = paceOf(view);
	const paceRatio = pace ? pace.ratio : null;
	return {
		totalSec,
		leftSec,
		loggedHours,
		keptHours,
		lostHours,
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
