/**
 * What the swatch picker lists (pure). By default only filaments the palettes and the generator
 * would pick ({@link isAllowedFilament}) are shown; "show all types" (or a search) also lists the
 * excluded ones, each carrying its reason. Same-brand duplicates collapse, and the grids are ordered
 * so near-identical blacks and whites do not bury everything else.
 */
import { compareByHue, deltaE2000, hexToLab as rawHexToLab, isNeutral, type Lab } from './color.ts';
import { exclusionReason, POPULAR_BRANDS, type SwatchTuple } from './palettes.ts';

export interface PickerEntry {
	t: SwatchTuple;
	/** Why palettes never pick it ('' when they may). */
	reason: string;
	/** Same-looking entries of other brands merged into this one (the representative itself is not listed). */
	others?: PickerEntry[];
}

export interface PickerOptions {
	/** List the excluded types too (tagged with their reason). */
	showAll?: boolean;
	/** Only these brands (empty: all). */
	brands?: string[];
	/** Preferred brands: their swatches come first. */
	preferred?: string[];
	/** Free text: every word must be in the brand, name, material or hex. */
	query?: string;
}

export interface PickerResult {
	neutrals: PickerEntry[];
	colorful: PickerEntry[];
	/** Excluded types hidden right now (0 when showing them). */
	hidden: number;
}

/** Same-brand colors closer than this (CIEDE2000) read as one swatch. */
export const DUPLICATE_DE = 1;

/** Entries of different brands closer than this (CIEDE2000) read as one swatch when several brands are in view. */
export const CROSS_BRAND_DE = 3;

const lc = (s: string) => s.toLowerCase();

// The catalog is a few thousand hex values; converting each once keeps clustering fast.
const labCache = new Map<string, Lab>();
function hexToLab(hex: string): Lab {
	let l = labCache.get(hex);
	if (!l) labCache.set(hex, (l = rawHexToLab(hex)));
	return l;
}

/** Why this swatch is not offered by default ('' when it is). */
export const pickerReason = (t: SwatchTuple): string => exclusionReason(t);

/** Keep the first of each group of same-brand entries with the same hex or ΔE < 1. */
export function collapseDuplicates(entries: PickerEntry[]): PickerEntry[] {
	const kept = new Map<string, { hex: string; lab: Lab }[]>();
	const out: PickerEntry[] = [];
	for (const e of entries) {
		const b = lc(e.t[0]);
		const hex = lc(e.t[2]);
		let list = kept.get(b);
		if (!list) kept.set(b, (list = []));
		const lab = hexToLab(hex);
		if (
			list.some(
				(k) =>
					k.hex === hex ||
					(Math.abs(k.lab[0] - lab[0]) < DUPLICATE_DE * 1.75 &&
						deltaE2000(k.lab, lab) < DUPLICATE_DE)
			)
		)
			continue;
		list.push({ hex, lab });
		out.push(e);
	}
	return out;
}

/** Rank of a brand for ordering: preferred brands (in the given order), then popular ones, then the rest. */
function brandRank(brand: string, preferred: string[]): number {
	const b = lc(brand);
	const p = preferred.findIndex((x) => lc(x) === b);
	if (p >= 0) return p;
	const pop = POPULAR_BRANDS.findIndex((x) => lc(x) === b);
	return preferred.length + (pop >= 0 ? pop : POPULAR_BRANDS.length);
}

/** Lightness band of a neutral (0 = lightest) in steps of 8 CIELAB L. */
export const lightnessBand = (hex: string) => Math.floor((100 - hexToLab(hex)[0]) / 8);

const POPULAR_SET = new Set(POPULAR_BRANDS.map(lc));

/**
 * Merge entries that look the same across brands (leader clustering, ΔE2000 < `threshold`). Leaders are
 * taken in order: allowed before excluded, preferred brand, popular brand, then others; for a cluster led
 * by an "other" brand, the member closest to the cluster centre represents it. The rest go to `others`.
 */
export function mergeAcrossBrands(
	entries: PickerEntry[],
	preferred: string[] = [],
	threshold = CROSS_BRAND_DE
): PickerEntry[] {
	const pref = new Set(preferred.map(lc));
	const tier = (e: PickerEntry) => {
		const b = lc(e.t[0]);
		return (e.reason ? 3 : 0) + (pref.has(b) ? 0 : POPULAR_SET.has(b) ? 1 : 2);
	};
	const items = entries
		.map((e, i) => ({ e, i, lab: hexToLab(e.t[2]), tier: tier(e), chroma: 0 }))
		.map((x) => ({ ...x, chroma: Math.hypot(x.lab[1], x.lab[2]) }))
		.sort((a, b) => a.tier - b.tier || a.i - b.i);
	// ΔE2000 >= |ΔL| / 1.75 (S_L stays below ~1.75), so far-apart lightness skips the full formula.
	const maxDL = threshold * 1.75;
	type Item = (typeof items)[number];
	const clusters: { lead: Item; members: Item[] }[] = [];
	// Clusters bucketed by leader lightness: only the neighbouring buckets can hold a match.
	const buckets = new Map<number, typeof clusters>();
	const bucketOf = (l: number) => Math.floor(l / maxDL);
	for (const it of items) {
		const b = bucketOf(it.lab[0]);
		let home: (typeof clusters)[number] | undefined;
		for (let k = b - 1; k <= b + 1 && !home; k++) {
			for (const c of buckets.get(k) ?? []) {
				if (Math.abs(c.lead.lab[0] - it.lab[0]) > maxDL) continue;
				// Cheap reject: ΔE2000 is never far below the plain Lab distance divided by the weighting (S_L, S_C <= this).
				const da = c.lead.lab[1] - it.lab[1];
				const db = c.lead.lab[2] - it.lab[2];
				const dl = c.lead.lab[0] - it.lab[0];
				const cmax = Math.max(c.lead.chroma, it.chroma);
				const reach = threshold * 1.25 * Math.max(1.75, 1 + 0.045 * cmax);
				if (dl * dl + da * da + db * db > reach * reach) continue;
				if (deltaE2000(c.lead.lab, it.lab) < threshold) {
					home = c;
					break;
				}
			}
		}
		if (home) {
			home.members.push(it);
			continue;
		}
		const c = { lead: it, members: [it] };
		clusters.push(c);
		const list = buckets.get(b);
		if (list) list.push(c);
		else buckets.set(b, [c]);
	}
	const out = clusters.map((c) => {
		let rep = c.lead;
		if (rep.tier % 3 === 2) {
			const pool = c.members.filter((m) => m.tier === rep.tier);
			if (pool.length > 2) {
				const mean = [0, 1, 2].map((k) => pool.reduce((a, m) => a + m.lab[k], 0) / pool.length) as [
					number,
					number,
					number
				];
				rep = pool.reduce((best, m) =>
					deltaE2000(m.lab, mean) < deltaE2000(best.lab, mean) ? m : best
				);
			}
		}
		const others = c.members.filter((m) => m !== rep).map((m) => m.e);
		return { i: rep.i, entry: others.length ? { ...rep.e, others } : rep.e };
	});
	return out.sort((a, b) => a.i - b.i).map((x) => x.entry);
}

function computePicker(items: SwatchTuple[], opts: PickerOptions): PickerResult {
	const brands = new Set((opts.brands ?? []).map(lc));
	const preferred = opts.preferred ?? [];
	const words = lc((opts.query ?? '').replace(/^#/, ''))
		.split(/\s+/)
		.filter(Boolean);
	const matching = items.filter((t) => {
		if (brands.size && !brands.has(lc(t[0]))) return false;
		if (!words.length) return true;
		const hay = `${t[0]} ${t[1]} ${t[3]} ${t[2].slice(1)}`.toLowerCase();
		return words.every((w) => hay.includes(w));
	});
	// Allowed first, so a duplicate collapses onto the entry palettes could pick.
	const all = collapseDuplicates(
		matching
			.map((t): PickerEntry => ({ t, reason: pickerReason(t) }))
			.sort((a, b) => Number(!!a.reason) - Number(!!b.reason))
	);
	const reveal = !!opts.showAll || words.length > 0;
	const shown = reveal ? all : all.filter((e) => !e.reason);
	const hidden = reveal ? 0 : all.length - shown.length;
	// Several brands in view and no search: same-looking swatches of different brands become one.
	const visible = brands.size !== 1 && !words.length ? mergeAcrossBrands(shown, preferred) : shown;

	const rank = (e: PickerEntry) => brandRank(e.t[0], preferred);
	const neutral = visible
		.filter((e) => isNeutral(e.t[2]))
		.map((e) => ({ e, band: lightnessBand(e.t[2]), r: rank(e), l: hexToLab(e.t[2])[0] }))
		.sort(
			(a, b) =>
				a.band - b.band || a.r - b.r || lc(a.e.t[0]).localeCompare(lc(b.e.t[0])) || b.l - a.l
		)
		.map((x) => x.e);
	const colorfulAll = visible
		.filter((e) => !isNeutral(e.t[2]))
		.sort((a, b) => compareByHue(a.t[2], b.t[2]));
	const isPref = (e: PickerEntry) => preferred.some((p) => lc(p) === lc(e.t[0]));
	const colorful = preferred.length
		? [...colorfulAll.filter(isPref), ...colorfulAll.filter((e) => !isPref(e))]
		: colorfulAll;
	return { neutrals: neutral, colorful, hidden };
}

/** The brands to show as chips: preferred, then selected, then recently used, then popular; capped (selected always kept). */
export function chipBrandList(opts: {
	available: string[];
	preferred: string[];
	selected: string[];
	recent: string[];
	max?: number;
}): string[] {
	const byLc = new Map(opts.available.map((b) => [lc(b), b]));
	const out: string[] = [];
	const add = (b?: string) => {
		const real = b && byLc.get(lc(b));
		if (real && !out.includes(real)) out.push(real);
	};
	opts.preferred.forEach(add);
	opts.selected.forEach(add);
	const forced = out.length;
	opts.recent.forEach(add);
	POPULAR_BRANDS.forEach(add);
	return out.slice(0, Math.max(forced, opts.max ?? 9));
}

let memo: { items: SwatchTuple[]; key: string; result: PickerResult } | undefined;

/** The picker's lists. The last query-free result is memoized per (items, brands, preferred, showAll). */
export function pickerSwatches(items: SwatchTuple[], opts: PickerOptions = {}): PickerResult {
	if ((opts.query ?? '').trim()) return computePicker(items, opts);
	const key = JSON.stringify([!!opts.showAll, opts.brands ?? [], opts.preferred ?? []]);
	if (memo && memo.items === items && memo.key === key) return memo.result;
	const result = computePicker(items, opts);
	memo = { items, key, result };
	return result;
}
