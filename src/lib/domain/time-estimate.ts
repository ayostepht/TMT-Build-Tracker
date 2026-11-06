/**
 * Print-time estimates for plates that have no time of their own (plates made by the
 * arranger). The only time data the app ships is MakeGood's per-plate times from the
 * X/P/A profile, so each X/P/A plate's time is split over its parts by their share of
 * the plate's BOM grams, and parts that are on no X/P/A plate (variants) are estimated
 * from their grams at the kit-wide seconds-per-gram ratio and marked "rough".
 *
 * Precedence everywhere: slicer time > learned per-part time ("from your slice", see
 * `part-profile.ts`) > MakeGood profile time > this estimate.
 * Pure: no DB, no Svelte.
 */

export interface TimePartInput {
	slug: string;
	bomGrams: number | null;
	qty: number | null;
}

/** An X/P/A (or any profile) plate with MakeGood's time per run. */
export interface TimeLayoutPlate {
	number: number;
	estSeconds: number | null;
	runs: number;
	perPartRuns?: boolean;
	parts: string[];
}

export interface PartTime {
	/** Seconds to print every copy of the part (all of its qty). */
	totalSec: number;
	/** True when estimated from grams rather than taken from a MakeGood plate. */
	rough: boolean;
	/** Taken from the build's print template (the user's own sliced file). */
	learned?: boolean;
	/** Grams by filament role for every copy of the part, learned parts only. */
	gramsByRole?: Record<string, number>;
}

/** What the build learned about one part (already mapped to the part's current role). */
export interface LearnedTime {
	secondsPerCopy: number | null;
	/** Grams per copy by role. */
	gramsByRole: Record<string, number>;
	/** Copies of the part the sliced file printed; the multiplier for parts with no quantity of their own. */
	copies?: number | null;
}

export interface TimeModel {
	byPart: Map<string, PartTime>;
	/** Kit-wide seconds per gram of printed plastic, or null without usable plates. */
	secPerGram: number | null;
}

export const ESTIMATE_LABEL = "estimate from MakeGood's X/P/A times";

const grams = (p: TimePartInput | undefined): number | null =>
	p && typeof p.bomGrams === 'number' && p.bomGrams > 0 ? p.bomGrams : null;

/** Alternative parts for one function (a template's variant group): only the part lists matter here. */
export interface TimeVariantGroup {
	options: { parts: string[] }[];
}

export function buildTimeModel(
	parts: TimePartInput[],
	layout: TimeLayoutPlate[],
	groups: TimeVariantGroup[] = [],
	learned?: ReadonlyMap<string, LearnedTime>
): TimeModel {
	const info = new Map(parts.map((p) => [p.slug, p]));
	const byPart = new Map<string, PartTime>();
	const add = (slug: string, sec: number) => {
		const cur = byPart.get(slug);
		byPart.set(slug, { totalSec: (cur?.totalSec ?? 0) + sec, rough: false });
	};
	let ratioSec = 0;
	let ratioGrams = 0;
	for (const pl of layout) {
		const est = pl.estSeconds;
		if (!est || est <= 0 || !pl.parts.length) continue;
		const runs = Math.max(1, pl.runs || 1);
		if (pl.perPartRuns) {
			// each part is its own unit printed `runs` times, the plate time per run
			for (const s of pl.parts) {
				add(s, est * runs);
				const g = grams(info.get(s));
				if (g) {
					ratioSec += est * runs;
					ratioGrams += g;
				}
			}
			continue;
		}
		const known = pl.parts.map((s) => grams(info.get(s)));
		const knownVals = known.filter((g): g is number => g != null);
		// parts without grams weigh as much as the average part that has them
		const fill = knownVals.length ? knownVals.reduce((a, b) => a + b, 0) / knownVals.length : 1;
		const weights = known.map((g) => g ?? fill);
		const sum = weights.reduce((a, b) => a + b, 0);
		const total = est * runs;
		pl.parts.forEach((s, i) => add(s, (total * weights[i]) / sum));
		if (knownVals.length === pl.parts.length) {
			ratioSec += total;
			ratioGrams += sum;
		}
	}
	const secPerGram = ratioGrams > 0 ? ratioSec / ratioGrams : null;
	if (secPerGram) {
		for (const p of parts) {
			const g = grams(p);
			if (!byPart.has(p.slug) && g) byPart.set(p.slug, { totalSec: g * secPerGram, rough: true });
		}
	}
	// The user's own slice beats MakeGood's numbers for every part it covers.
	for (const p of parts) {
		const l = learned?.get(p.slug);
		if (!l || !(l.secondsPerCopy && l.secondsPerCopy > 0)) continue;
		const n = Math.max(1, p.qty ?? l.copies ?? 1);
		byPart.set(p.slug, {
			totalSec: l.secondsPerCopy * n,
			rough: false,
			learned: true,
			gramsByRole: Object.fromEntries(Object.entries(l.gramsByRole).map(([r, g]) => [r, g * n]))
		});
	}
	// Variant parts with neither a plate nor grams (bucket seat, two-piece footrest, ...): assume the
	// option takes about as long as the other option(s) of its group, shared evenly over its parts.
	for (const g of groups) {
		const known = g.options.map((o) =>
			o.parts.reduce((a, s) => a + (byPart.get(s)?.totalSec ?? 0), 0)
		);
		g.options.forEach((o, i) => {
			const missing = o.parts.filter((s) => !byPart.has(s) && info.has(s));
			const siblings = known.filter((k, j) => j !== i && k > 0);
			if (!missing.length || !siblings.length) return;
			const target = siblings.reduce((a, b) => a + b, 0) / siblings.length;
			const left = Math.max(0, target - known[i]);
			if (left <= 0) return;
			for (const s of missing) byPart.set(s, { totalSec: left / missing.length, rough: true });
		});
	}
	return { byPart, secPerGram };
}

export interface ArrangedForTime {
	number: number;
	runs: number;
	/** Part slug of every placed item on the plate (one entry per item, repeats allowed). */
	items: string[];
}

export interface PlateTimeEstimate {
	/** Seconds per run, or null when none of the plate's parts has a time. */
	estSeconds: number | null;
	/** Includes a grams-only guess for a part that is on no X/P/A plate. */
	rough: boolean;
	/** Every timed item comes from the build's print template. */
	learned?: boolean;
	/** Grams per run by role, when every item on the plate has learned grams. */
	gramsByRole?: Record<string, number>;
}

/**
 * Time per run for arranged plates: each part's total time is spread over all of its
 * placed items (times the runs of their plate), and a plate sums its items.
 */
export function estimateArranged(
	model: TimeModel,
	plates: ArrangedForTime[]
): Map<number, PlateTimeEstimate> {
	const itemsOf = new Map<string, number>();
	for (const pl of plates)
		for (const s of pl.items) itemsOf.set(s, (itemsOf.get(s) ?? 0) + Math.max(1, pl.runs || 1));
	const out = new Map<number, PlateTimeEstimate>();
	for (const pl of plates) {
		let sec = 0;
		let any = false;
		let rough = false;
		let allLearned = true;
		let allGrams = pl.items.length > 0;
		const grams: Record<string, number> = {};
		for (const s of pl.items) {
			const t = model.byPart.get(s);
			const n = itemsOf.get(s);
			if (!t || !n) {
				allLearned = false;
				allGrams = false;
				continue;
			}
			any = true;
			sec += t.totalSec / n;
			if (t.rough) rough = true;
			if (!t.learned) allLearned = false;
			if (t.gramsByRole && Object.keys(t.gramsByRole).length) {
				for (const [r, g] of Object.entries(t.gramsByRole)) grams[r] = (grams[r] ?? 0) + g / n;
			} else allGrams = false;
		}
		out.set(pl.number, {
			estSeconds: any ? Math.round(sec) : null,
			rough,
			...(any && allLearned ? { learned: true } : {}),
			...(allGrams && allLearned
				? {
						gramsByRole: Object.fromEntries(
							Object.entries(grams).map(([r, g]) => [r, Math.round(g * 100) / 100])
						)
					}
				: {})
		});
	}
	return out;
}
