/**
 * Filament and print-time accounting.
 *
 * A "unit" is one plate, except a perPartRuns plate (e.g. the wheel rim plate),
 * where each part is its own unit printed `plate.runs` times. Estimate per run:
 * slicer grams entered on the plate if any, else the BOM grams divided by runs.
 * Used: logged grams, or the estimate when the unit is printed with nothing
 * logged. A running print still counts as to print.
 */
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

export function estPerRun(view: BuildView, u: Unit): number {
	const s = slicerFor(view, u);
	if (s) return s;
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
		const us = all.filter((u) => u.role === f.key);
		const used = us.reduce((a, u) => a + unitUsed(view, u), 0);
		const need = us.reduce((a, u) => a + unitLeft(view, u), 0);
		const haveGrams = (Number(f.spools) || 0) * 1000;
		const spare = haveGrams - used - need;
		return {
			role: f.key,
			used,
			need,
			total: us.reduce((a, u) => a + estTotal(view, u), 0),
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
	for (const pl of view.plates) {
		const est = pl.estSeconds || 0;
		totalSec += est * plateTotalRuns(pl);
		leftSec += est * plateRunsLeft(view, pl);
	}
	let loggedHours = 0;
	let estOfTimed = 0;
	let actualOfTimed = 0;
	for (const r of view.runs) {
		const h = Number(r.hours) || 0;
		loggedHours += h;
		if (h > 0 && r.result === 'Success' && r.plateNumber != null) {
			const est = plateByNumber(view, r.plateNumber)?.estSeconds;
			if (est) {
				estOfTimed += est / 3600;
				actualOfTimed += h;
			}
		}
	}
	const paceRatio = estOfTimed >= 12 ? actualOfTimed / estOfTimed : null;
	return {
		totalSec,
		leftSec,
		loggedHours,
		paceRatio,
		adjustedLeftSec: paceRatio ? leftSec * paceRatio : null
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
