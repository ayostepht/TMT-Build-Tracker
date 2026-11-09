/**
 * What the swatch picker lists (pure). By default only filaments the palettes and the generator
 * would pick ({@link isAllowedFilament}) are shown; "show all types" (or a search) also lists the
 * excluded ones, each carrying its reason. Same-brand duplicates collapse, and the grids are ordered
 * so near-identical blacks and whites do not bury everything else.
 */
import { compareByHue, deltaE2000, hexToLab, isNeutral } from './color.ts';
import { exclusionReason, POPULAR_BRANDS, type SwatchTuple } from './palettes.ts';

export interface PickerEntry {
	t: SwatchTuple;
	/** Why palettes never pick it ('' when they may). */
	reason: string;
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

const lc = (s: string) => s.toLowerCase();

/** Why this swatch is not offered by default ('' when it is). */
export const pickerReason = (t: SwatchTuple): string => exclusionReason(t);

/** Keep the first of each group of same-brand entries with the same hex or ΔE < 1. */
export function collapseDuplicates(entries: PickerEntry[]): PickerEntry[] {
	const kept = new Map<string, { hex: string; lab: ReturnType<typeof hexToLab> }[]>();
	const out: PickerEntry[] = [];
	for (const e of entries) {
		const b = lc(e.t[0]);
		const hex = lc(e.t[2]);
		let list = kept.get(b);
		if (!list) kept.set(b, (list = []));
		const lab = hexToLab(hex);
		if (list.some((k) => k.hex === hex || deltaE2000(k.lab, lab) < DUPLICATE_DE)) continue;
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

export function pickerSwatches(items: SwatchTuple[], opts: PickerOptions = {}): PickerResult {
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
	const visible = reveal ? all : all.filter((e) => !e.reason);
	const hidden = reveal ? 0 : all.length - visible.length;

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
