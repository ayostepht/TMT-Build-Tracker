/**
 * Color palettes for the TMT's four base slots (pure): curated pre-made ones, a harmony
 * based generator, and the matcher that maps target colors to the nearest real catalog
 * filaments (CIEDE2000, preferring a brand and plain PETG / TPU 95A).
 */
import { ROLE_LABEL } from './labels.ts';
import { materialFamily, suggestName } from '../filament-catalog.ts';
import {
	deltaE2000,
	hexToLab,
	hexToOklch,
	isHex,
	isNeutral,
	normHex,
	oklchToHex,
	type Lab,
	type Oklch
} from './color.ts';

/**
 * Compact catalog entry as served by `/api/filaments/swatches`: brand, color name, #hex, material,
 * and optionally space-separated catalog flags (see {@link FLAG_MATTE} and friends).
 */
export type SwatchTuple = [
	brand: string,
	name: string,
	hex: string,
	material: string,
	flags?: string
];

/** Flag tokens a swatch tuple's optional 5th element may carry (from the catalog's structured fields). */
export const FLAG_MATTE = 'matte';
export const FLAG_TRANSLUCENT = 'translucent';
export const FLAG_GLOW = 'glow';
export const FLAG_MULTI = 'multi';
export const FLAG_SILK = 'silk';
export const FLAG_SPARKLE = 'sparkle';

export const SLOTS = ['primary', 'accent', 'soft', 'tire'] as const;
export type SlotKey = (typeof SLOTS)[number];
export type PaletteTargets = Record<SlotKey, string>;

export const SLOT_LABEL: Record<SlotKey, string> = {
	primary: ROLE_LABEL.primary,
	accent: ROLE_LABEL.accent,
	soft: ROLE_LABEL.soft,
	tire: ROLE_LABEL.tire
};

export interface Palette {
	id: string;
	name: string;
	description: string;
	targets: PaletteTargets;
}

const P = (
	id: string,
	name: string,
	description: string,
	primary: string,
	accent: string,
	soft: string,
	tire: string
): Palette => ({ id, name, description, targets: { primary, accent, soft, tire } });

export const PALETTES: Palette[] = [
	P(
		'columbus-blues',
		'Columbus Blues',
		'The original colors: deep blue frame, bright blue accents, sky blue tires and straps.',
		'#034e89',
		'#0378d0',
		'#0378d0',
		'#5fb4f0'
	),
	P(
		'ocean',
		'Ocean',
		'Teal and aqua with coral tires and straps, like a shallow reef.',
		'#0e7c86',
		'#7fd6e8',
		'#2aa5c7',
		'#ff8a65'
	),
	P(
		'sunset',
		'Sunset',
		'Warm orange frame with golden accents and raspberry tires.',
		'#e8553d',
		'#ffb347',
		'#f0788f',
		'#c2185b'
	),
	P(
		'forest',
		'Forest',
		'Deep green with fresh leaf accents and bark brown tires.',
		'#2f6b3a',
		'#a3c46b',
		'#6b8f4e',
		'#8b5a2b'
	),
	P(
		'candy',
		'Candy',
		'Bubblegum pink, sky blue and lilac with sunny yellow tires. Very toddler.',
		'#ff5fa2',
		'#5fd3ff',
		'#b388ff',
		'#ffe14d'
	),
	P(
		'galaxy',
		'Galaxy',
		'Midnight purple with cyan and violet glow, magenta tires.',
		'#2a1b5e',
		'#36d1dc',
		'#7a4dff',
		'#e040a0'
	),
	P(
		'fire-truck',
		'Fire Truck',
		'Engine red, white trim, safety yellow, red tires and straps.',
		'#d31f26',
		'#f2f2f2',
		'#ffc20e',
		'#d31f26'
	),
	P(
		'mono-graphite',
		'Mono Graphite',
		'Understated grays with slate tires, easy on the eye.',
		'#3a3d44',
		'#c9ccd2',
		'#8a8f99',
		'#5c616b'
	),
	P(
		'pastel',
		'Pastel',
		'Soft pink, baby blue and lavender with peach tires.',
		'#f4a6c1',
		'#a8d8ea',
		'#c3b1e1',
		'#ffc99a'
	),
	P(
		'superhero',
		'Superhero',
		'Hero blue, cape red and a yellow flash, red tires and straps.',
		'#1f4fd8',
		'#e11d2e',
		'#ffd400',
		'#d81f2a'
	),
	P(
		'princess-pink',
		'Princess Pink',
		'Rose pink, gold trim and lilac with plum tires.',
		'#ec6fa6',
		'#f9d36b',
		'#c58ce6',
		'#9c3d8f'
	),
	P(
		'camo',
		'Camo',
		'Olive and tan with khaki tires and straps.',
		'#5a6b3c',
		'#8b7355',
		'#3f4a2c',
		'#a0875f'
	),
	P(
		'sunshine',
		'Sunshine',
		'Happy yellow with sky blue and red tires.',
		'#f7c52b',
		'#3aa0e0',
		'#ff9f43',
		'#e53935'
	)
];

// ---- matching targets to real filaments

export interface Match {
	brand: string;
	colorName: string;
	hex: string;
	material: string;
	/** Filament name to store on the slot ("Overture Blue"). */
	name: string;
	/** CIEDE2000 distance from the wanted color. */
	de: number;
	target: string;
	/** True when no standard filament was close, so a fallback (other brand, matte, far color) was used. */
	relaxed?: boolean;
	/** Why the match is relaxed, ready to show in the UI. */
	relaxedReason?: string;
}

export interface MatchOptions {
	/** Brand to prefer (case-insensitive); a small penalty for others, not a hard filter. */
	brand?: string;
	/** Several preferred brands: a match from any of them counts as preferred. Combined with `brand`. */
	brands?: string[];
	/** Entries already used by another slot. */
	exclude?: Set<string>;
	/** Colors the match must stay clear of (the primary when matching the accent). */
	avoid?: { hex: string; minDe: number }[];
}

const BRAND_PENALTY = 12;

/** The preferred brands of the options, trimmed and de-duplicated (case-insensitive, first spelling kept). */
export function wantedBrands(opts: { brand?: string; brands?: string[] }): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const b of [...(opts.brands ?? []), ...(opts.brand ? [opts.brand] : [])]) {
		const t = b.trim();
		if (t && !seen.has(t.toLowerCase())) {
			seen.add(t.toLowerCase());
			out.push(t);
		}
	}
	return out;
}

/** Brands that most makers can actually buy; a small nudge when no brand is chosen. */
export const POPULAR_BRANDS = [
	'Overture',
	'Bambu Lab',
	'Elegoo',
	'Polymaker',
	'eSUN',
	'Prusament',
	'Sunlu',
	'Jayo'
];
const POPULAR = new Set(POPULAR_BRANDS.map((b) => b.toLowerCase()));
const UNKNOWN_BRAND_PENALTY = 5;

const labs = new WeakMap<SwatchTuple[], Lab[]>();
function labsOf(items: SwatchTuple[]): Lab[] {
	let l = labs.get(items);
	if (!l) {
		l = items.map((i) => hexToLab(i[2]));
		labs.set(items, l);
	}
	return l;
}

export const tupleKey = (t: SwatchTuple) => `${t[0]}|${t[1]}|${t[3]}`;

/**
 * Filaments the palettes and the generator never pick on their own. The chair is a load-bearing
 * kids' mobility device, so we skip anything weaker or less consistent than plain PETG / TPU 95A,
 * and anything whose single catalog hex misleads (multi-color, glitter, glow, translucent).
 * `relaxable` entries are only a quality worry, not a safety one: the fallback may use them
 * (matte) when nothing standard is close. The manual swatch picker is not affected.
 * Patterns run on the color name and material (not the brand) and are case-insensitive.
 */
export const EXCLUDED_FILAMENTS: readonly {
	id: string;
	pattern: RegExp;
	flag?: string;
	relaxable?: boolean;
	reason: string;
}[] = [
	{
		id: 'matte',
		pattern: /\bmatt?e?\b/i,
		flag: FLAG_MATTE,
		relaxable: true,
		reason: 'matte prints with poorer layer quality and strength'
	},
	{
		id: 'silk',
		pattern: /\bsilk/i,
		flag: FLAG_SILK,
		reason: 'silk blends are weaker between layers'
	},
	{
		id: 'transparent',
		pattern: /\b(tr?ansparent|translucent|clear|see-?through)\b/i,
		flag: FLAG_TRANSLUCENT,
		reason: 'transparent filament has a misleading color and weaker prints'
	},
	{
		id: 'glow',
		pattern: /\b(glow|luminous|noctilucent|phosphor\w*)\b/i,
		flag: FLAG_GLOW,
		reason: 'glow pigments are abrasive and weaken the part'
	},
	{ id: 'marble', pattern: /\bmarble?\b/i, reason: 'marble blends are brittle' },
	{ id: 'wood', pattern: /\bwood(en|y)?\b/i, reason: 'wood-filled filament is brittle' },
	{
		id: 'sparkle',
		pattern: /sparkl|glitter|galaxy|starry|stardust/i,
		flag: FLAG_SPARKLE,
		reason: 'glitter and galaxy fillers weaken the part'
	},
	{
		id: 'multicolor',
		pattern: /rainbow|gradient|multi-?colou?r|\bmulti\b|\bdual\b|tri-?colou?r|chameleon/i,
		flag: FLAG_MULTI,
		reason: 'multi-color products do not match a single hex'
	},
	{
		id: 'filled',
		pattern: /\b(cf|gf)\d*\b|-(cf|gf)\d*\b|carbon[\s-]?fib|glass[\s-]?fib|\bfibre?\b/i,
		reason: 'carbon/glass-filled filament is abrasive and brittle'
	},
	{
		id: 'rock',
		pattern: /\brock\b|\bterrazzo\b|\bspeckle[ds]?\b|\bgranite\b/i,
		reason: 'stone and speckle textured filaments are rough and not one color'
	},
	{ id: 'foam', pattern: /foam/i, reason: 'foaming TPU is soft and weak' }
];

/** The only TPU hardness used for the soft and tire slots. */
export const ALLOWED_TPU_HARDNESS = '95A';

/** Shore hardnesses mentioned in a TPU's text ("95A", "64D", "TPU90"); bare TPU numbers mean A. */
function hardnesses(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/(?<![\d.])(\d{2,3})\s?-?([ad])(?![a-z])/gi))
		out.push(`${m[1]}${m[2].toUpperCase()}`);
	for (const m of text.matchAll(/tpu\s?-?(\d{2,3})(?![\d.])/gi))
		if (!out.some((h) => h.startsWith(m[1]))) out.push(`${m[1]}A`);
	return out;
}

/** Why a swatch is excluded ('' when fine). `allowMatte` is the fallback tier. */
export function exclusionReason(t: SwatchTuple, allowMatte = false): string {
	const text = `${t[1]} ${t[3]}`;
	const flags = (t[4] ?? '').toLowerCase().split(/\s+/);
	for (const e of EXCLUDED_FILAMENTS) {
		if (allowMatte && e.relaxable) continue;
		if ((e.flag && flags.includes(e.flag)) || e.pattern.test(text)) return e.reason;
	}
	if (materialFamily(t[3]) === 'tpu') {
		// Brands that name the grade instead of the number (Extrudr FLEX Medium / Soft / Hard).
		if (/\b(medium|soft|hard|semi-?flex|for ams)\b/i.test(t[1]))
			return 'only 95A TPU is used (a different grade is named)';
		const h = hardnesses(`${t[1]} ${t[3]}`);
		if (h.some((x) => x !== ALLOWED_TPU_HARDNESS))
			return `only ${ALLOWED_TPU_HARDNESS} TPU is used (this is ${h.find((x) => x !== ALLOWED_TPU_HARDNESS)})`;
	}
	return '';
}

export const isAllowedFilament = (t: SwatchTuple, allowMatte = false) =>
	exclusionReason(t, allowMatte) === '';

/** Extra distance for lesser variants of the allowed materials. */
function materialPenalty(material: string): number {
	const m = material
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, '-');
	switch (materialFamily(m)) {
		case 'petg':
			return m === 'petg' ? 0 : 5;
		case 'tpu':
			return m === 'tpu' || m === 'tpu-95a' ? 0 : 4;
		default:
			return 8;
	}
}

/** The preferred brand wins only within this many ΔE of the best match of any brand ... */
export const BRAND_MARGIN_DE = 6;
/** ... or when it is this close in absolute terms (a barely visible difference). */
export const BRAND_OK_DE = 10;

/** A match farther than this (CIEDE2000) triggers the relaxed fallback tiers. */
export const MAX_STANDARD_DE = 25;

function pick(
	target: string,
	items: SwatchTuple[],
	opts: MatchOptions,
	allowMatte: boolean,
	want: Set<string>,
	onlyBrands = false
): Match | null {
	const t = hexToLab(target);
	const L = labsOf(items);
	const avoid = (opts.avoid ?? []).map((a) => ({ lab: hexToLab(a.hex), min: a.minDe }));
	let best = -1;
	let bestScore = Infinity;
	let bestDe = 0;
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		if (opts.exclude?.has(tupleKey(it))) continue;
		if (onlyBrands && !want.has(it[0].toLowerCase())) continue;
		if (!isAllowedFilament(it, allowMatte)) continue;
		if (avoid.some((a) => deltaE2000(L[i], a.lab) < a.min)) continue;
		const de = deltaE2000(t, L[i]);
		const score =
			de +
			materialPenalty(it[3]) * 0.5 +
			(allowMatte && exclusionReason(it) ? 3 : 0) +
			(want.size
				? !want.has(it[0].toLowerCase())
					? BRAND_PENALTY
					: 0
				: POPULAR.has(it[0].toLowerCase())
					? 0
					: UNKNOWN_BRAND_PENALTY);
		if (score < bestScore) {
			bestScore = score;
			best = i;
			bestDe = de;
		}
	}
	if (best < 0) return null;
	const [brand, colorName, hex, material] = items[best];
	return {
		brand,
		colorName,
		hex,
		material,
		name: suggestName(brand, colorName),
		de: bestDe,
		target
	};
}

/**
 * Closest allowed filament to `target`. Tiers: the preferred brand (if any), then every brand,
 * then every brand with matte allowed (never silk, transparent, filled, ...). The first tier within
 * {@link MAX_STANDARD_DE} wins; otherwise the closest of all tiers is returned with `relaxed: true`.
 */
export function nearest(
	target: string,
	items: SwatchTuple[],
	opts: MatchOptions = {}
): Match | null {
	const names = wantedBrands(opts);
	const want = new Set(names.map((b) => b.toLowerCase()));
	const hasWant = want.size > 0;
	const tiers: { m: Match | null; note: string }[] = [];
	if (hasWant) tiers.push({ m: pick(target, items, opts, false, want, true), note: '' });
	tiers.push({ m: pick(target, items, opts, false, want), note: 'other brand' });
	tiers.push({ m: pick(target, items, opts, true, want), note: 'matte' });
	// The preferred brand only wins when it is nearly as close as the best match of any brand.
	const anyBest = Math.min(...tiers.slice(hasWant ? 1 : 0).map((x) => x.m?.de ?? Infinity));
	const brandFar =
		hasWant && !!tiers[0].m && tiers[0].m.de > Math.max(anyBest + BRAND_MARGIN_DE, BRAND_OK_DE);
	const ok = tiers.find((x, i) => x.m && x.m.de <= MAX_STANDARD_DE && !(brandFar && i === 0));
	let chosen = ok;
	if (!chosen) {
		for (const x of tiers) if (x.m && (!chosen || x.m.de < chosen.m!.de - 1e-9)) chosen = x;
	}
	if (!chosen?.m) return null;
	const first = tiers[0];
	const relaxed = chosen !== first || chosen.m.de > MAX_STANDARD_DE;
	if (!relaxed) return chosen.m;
	const m = chosen.m;
	const how =
		chosen.note === 'matte'
			? ' (matte)'
			: chosen.note && hasWant
				? ` (not ${names.join(', ')})`
				: '';
	const reason =
		hasWant && chosen.note === 'other brand' && m.de <= MAX_STANDARD_DE
			? names.length === 1
				? `No close ${names[0]} match; using ${m.name}`
				: `No close match in ${names.join(', ')}; using ${m.name}`
			: m.de > MAX_STANDARD_DE
				? `Closest standard filament isn't close (ΔE ${m.de.toFixed(0)}); using ${m.name}${how}`
				: `No close standard filament; using ${m.name}${how}`;
	return { ...m, relaxed: true, relaxedReason: reason };
}

export interface CatalogSwatches {
	petg: SwatchTuple[];
	tpu: SwatchTuple[];
}

export type ResolvedPalette = Partial<Record<SlotKey, Match>>;

/** Minimum CIEDE2000 gap between the matched primary and accent filaments. */
export const MIN_SLOT_GAP = 14;

/** Map each target to the nearest real filament: PETG for primary/accent, TPU for soft/tires. */
export function resolvePalette(
	targets: PaletteTargets,
	catalog: CatalogSwatches,
	opts: { brand?: string; brands?: string[] } = {}
): ResolvedPalette {
	const used = new Set<string>();
	const out: ResolvedPalette = {};
	for (const slot of SLOTS) {
		const items = slot === 'primary' || slot === 'accent' ? catalog.petg : catalog.tpu;
		const avoid =
			slot === 'accent' && out.primary
				? [{ hex: out.primary.hex, minDe: MIN_SLOT_GAP }]
				: slot === 'tire' && out.soft
					? [{ hex: out.soft.hex, minDe: 6 }]
					: undefined;
		const m = nearest(targets[slot], items, {
			brand: opts.brand,
			brands: opts.brands,
			exclude: used,
			avoid
		});
		if (m) {
			out[slot] = m;
			used.add(tupleKey([m.brand, m.colorName, m.hex, m.material]));
		}
	}
	return out;
}

/** Which of a build's slots take which palette color: by role key, else by material order. */
export function paletteSlots(
	filaments: { key: string; material: string }[]
): Partial<Record<SlotKey, string>> {
	const out: Partial<Record<SlotKey, string>> = {};
	for (const s of SLOTS) if (filaments.some((f) => f.key === s)) out[s] = s;
	const taken = new Set(Object.values(out));
	const rest = (fam: 'petg' | 'tpu') =>
		filaments.filter((f) => !taken.has(f.key) && materialFamily(f.material) === fam);
	const petg = rest('petg');
	const tpu = rest('tpu');
	for (const s of ['primary', 'accent'] as const)
		if (!out[s] && petg.length) out[s] = petg.shift()!.key;
	for (const s of ['soft', 'tire'] as const) if (!out[s] && tpu.length) out[s] = tpu.shift()!.key;
	return out;
}

// ---- generator

export type Harmony =
	'complementary' | 'analogous' | 'triadic' | 'monochrome' | 'contrast' | 'soft';

export const HARMONIES: { id: Harmony; label: string; hint: string }[] = [
	{ id: 'complementary', label: 'Complementary', hint: 'Opposite on the color wheel' },
	{ id: 'analogous', label: 'Analogous', hint: 'Neighbors on the wheel, calm' },
	{ id: 'triadic', label: 'Triadic', hint: 'Three evenly spaced hues, playful' },
	{ id: 'monochrome', label: 'Monochrome', hint: 'One hue, light and dark' },
	{ id: 'contrast', label: 'High contrast', hint: 'Bold, light against dark' },
	{ id: 'soft', label: 'Soft', hint: 'Pastel and gentle' }
];

/** Smallest CIEDE2000 gap the generator guarantees between the primary and accent targets. */
export const MIN_ACCENT_DE = 20;

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const hex = (o: Oklch) => oklchToHex({ ...o, l: clamp(o.l, 0, 1) });
const dE = (a: string, b: string) => deltaE2000(hexToLab(a), hexToLab(b));

/** Primary (TPU) target: the primary color family, as is, a touch lighter, or a touch darker and shifted. */
function softOfPrimary(p: Oklch, variant: number, primaryHex: string): string {
	if (variant === 0) return primaryHex;
	if (variant === 1) return hex({ ...p, l: Math.min(0.9, p.l + 0.1) });
	return hex({ l: clamp(p.l - 0.08, 0.3, 0.88), c: Math.max(p.c * 0.9, 0.06), h: p.h + 15 });
}

/** What the Accent (TPU) tire/strap color follows, in rotation: the accent hue, a third hue, or near black. */
const TIRE_PLAN = ['accent', 'accent', 'dark', 'third', 'accent', 'dark'] as const;

/** Smallest CIEDE2000 gap kept between the tire and soft targets. */
export const MIN_TIRE_SOFT_DE = 10;

/** Nudge `tire` in lightness until it is at least MIN_TIRE_SOFT_DE from `otherHex`. */
function apartFromHex(tire: Oklch, otherHex: string): string {
	let out = hex(tire);
	if (dE(out, otherHex) >= MIN_TIRE_SOFT_DE) return out;
	const dark = tire.l < 0.45 && tire.c < 0.06;
	const dls = dark ? [0.06, 0.12, 0.18] : [0.12, -0.12, 0.2, -0.2, 0.28, -0.28];
	const dhs = dark ? [0] : [0, 25, -25, 50, -50];
	for (const dh of dhs)
		for (const dl of dls) {
			const cand = hex({ ...tire, l: clamp(tire.l + dl, 0.12, 0.92), h: tire.h + dh });
			const d = dE(cand, otherHex);
			if (d >= MIN_TIRE_SOFT_DE) return cand;
			if (d > dE(out, otherHex)) out = cand;
		}
	return out;
}

/**
 * Tire/strap target. Colored (accent hue, primary hue or a third hue, at TPU-friendly lightness and
 * chroma) in about two of three variations, near black in the rest ("contrast" uses true black).
 * Deterministic in (harmony, shuffle); kept {@link MIN_TIRE_SOFT_DE} away from the soft target.
 */
function pickTire(o: {
	harmony: Harmony;
	shuffle: number;
	hi: number;
	pHue: number;
	aHue: number;
	softHex: string;
	jit: (amp: number) => number;
}): string {
	const { harmony, shuffle, pHue, aHue, softHex, jit } = o;
	const kind = TIRE_PLAN[(shuffle + o.hi) % TIRE_PLAN.length];
	if (kind === 'dark') {
		let t: Oklch = { l: 0.22, c: 0.01, h: 270 };
		if (harmony === 'contrast') t = { l: 0.18, c: 0.005, h: 270 };
		else if (harmony === 'soft') t = { l: 0.4, c: 0.015, h: 270 };
		else if (harmony === 'monochrome') t = { l: 0.24, c: 0.035, h: pHue };
		else if (shuffle % 2 === 1) t = { l: 0.25, c: 0.04, h: pHue };
		return apartFromHex(t, softHex);
	}
	const diff = ((aHue - pHue + 540) % 360) - 180;
	let h: number;
	if (harmony === 'monochrome') h = pHue;
	else if (kind === 'accent') h = aHue;
	else h = Math.abs(diff) > 150 ? pHue + 90 : pHue + diff / 2 + 180;
	const t: Oklch =
		harmony === 'soft'
			? { l: 0.74 + jit(0.03), c: 0.08 + Math.abs(jit(0.02)), h }
			: { l: 0.6 + jit(0.08), c: 0.13 + jit(0.03), h };
	return apartFromHex(t, softHex);
}

/**
 * Propose primary/accent (PETG) and soft/tire (TPU) target colors from a base color and a
 * harmony. `shuffle` 0 is the canonical proposal; other numbers give deterministic alternatives.
 */
export function generateTargets(baseHex: string, harmony: Harmony, shuffle = 0): PaletteTargets {
	const r = rng(shuffle * 7919 + HARMONIES.findIndex((h) => h.id === harmony) * 101 + 17);
	const jit = (amp: number) => (shuffle === 0 ? 0 : (r() * 2 - 1) * amp);
	const base = hexToOklch(baseHex);
	const neutral = isNeutral(baseHex);
	const hue = neutral ? 255 + shuffle * 47 : base.h;
	const side = shuffle % 2 === 0 ? 1 : -1;

	let p: Oklch = {
		l: clamp(base.l, 0.36, 0.86),
		c: neutral ? base.c : Math.max(base.c, 0.06),
		h: hue
	};
	// Lightness for an accent that sits clearly apart from the primary.
	const apart = (l: number, by: number) =>
		l >= 0.58 ? Math.max(0.3, l - by) : Math.min(0.9, l + by);
	let a: Oklch;
	switch (harmony) {
		case 'complementary':
			a = { l: apart(p.l, 0.2), c: Math.max(0.12, p.c), h: hue + 180 + jit(18) };
			break;
		case 'analogous':
			a = { l: apart(p.l, 0.18), c: Math.max(0.1, p.c * 0.95), h: hue + side * (30 + jit(10)) };
			break;
		case 'triadic':
			a = {
				l: apart(p.l, 0.15),
				c: Math.max(0.12, p.c),
				h: hue + (side > 0 ? 120 : 240) + jit(10)
			};
			break;
		case 'monochrome':
			a = { l: apart(p.l, 0.3), c: p.c * 0.8, h: hue + jit(6) };
			break;
		case 'contrast':
			p = { ...p, l: clamp(p.l, 0.4, 0.8), c: Math.max(p.c, 0.1) };
			a = { l: p.l >= 0.58 ? 0.3 : 0.9, c: Math.max(0.14, p.c), h: hue + 180 + jit(25) };
			break;
		case 'soft':
			p = {
				l: Math.max(Math.min(p.l, 0.74), 0.68) + jit(0.03),
				c: Math.min(p.c, 0.07) + 0.02,
				h: hue
			};
			a = { l: 0.9, c: 0.07 + Math.abs(jit(0.03)), h: hue + side * (35 + jit(15)) };
			break;
	}
	const primary = hex(p);
	let accent = hex(a);
	// Push the accent away in lightness (and up in chroma) until the gap is wide enough.
	let dir = a.l >= p.l ? 1 : -1;
	for (let i = 0; i < 40 && dE(primary, accent) < MIN_ACCENT_DE; i++) {
		a = { ...a, l: a.l + dir * 0.03, c: Math.min(0.2, a.c + 0.008) };
		if (a.l > 0.95 || a.l < 0.22) {
			dir = -dir;
			a.l = clamp(a.l, 0.22, 0.95);
		}
		accent = hex(a);
	}

	// Primary (TPU) is the primary color family; the variants keep "shuffle" interesting.
	const soft = softOfPrimary(p, shuffle % 3, primary);

	// Tires and straps: a real color choice, with black in some variations.
	const tire = pickTire({
		harmony,
		shuffle,
		hi: HARMONIES.findIndex((h) => h.id === harmony),
		pHue: hue,
		aHue: hexToOklch(accent).h,
		softHex: soft,
		jit
	});
	return { primary, accent, soft, tire };
}

// ---- generator with locked colors

/** Slots the user pinned to a color; the rest are auto-filled. */
export type LockedTargets = Partial<PaletteTargets>;

const DEFAULT_ANCHOR = '#1e88e5';

/** A generated tire, nudged clear of a soft color the user locked (no-op without one). */
function tireApart(tireHex: string, lockedSoft?: string): string {
	return lockedSoft ? apartFromHex(hexToOklch(tireHex), lockedSoft) : tireHex;
}

/** Keep only valid hexes, normalized (lowercase, with #). */
function cleanLocked(locked: LockedTargets): LockedTargets {
	const out: LockedTargets = {};
	for (const s of SLOTS) {
		const v = locked[s];
		if (typeof v === 'string' && isHex(v)) out[s] = normHex(v);
	}
	return out;
}

/** Push an accent (Oklch) away from `primaryHex` until the gap is at least MIN_ACCENT_DE. */
function withGap(primaryHex: string, a: Oklch): string {
	let cur = a;
	let out = hex(cur);
	let dir = cur.l >= hexToOklch(primaryHex).l ? 1 : -1;
	for (let i = 0; i < 40 && dE(primaryHex, out) < MIN_ACCENT_DE; i++) {
		cur = { ...cur, l: cur.l + dir * 0.03, c: Math.min(0.2, cur.c + 0.008) };
		if (cur.l > 0.95 || cur.l < 0.22) {
			dir = -dir;
			cur.l = clamp(cur.l, 0.22, 0.95);
		}
		out = hex(cur);
	}
	return out;
}

/** Soft and tire targets derived from a known primary and accent. */
function deriveSoftTire(
	primary: string,
	accent: string,
	harmony: Harmony,
	shuffle: number
): { soft: string; tire: string } {
	const hi = HARMONIES.findIndex((h) => h.id === harmony);
	const r = rng(shuffle * 6151 + hi * 131 + 29);
	const jit = (amp: number) => (shuffle === 0 ? 0 : (r() * 2 - 1) * amp);
	const p = hexToOklch(primary);
	const a = hexToOklch(accent);
	const pHue = isNeutral(primary) ? a.h : p.h;
	const aHue = isNeutral(accent) ? p.h : a.h;
	const soft = softOfPrimary({ ...p, h: pHue }, (shuffle + hi) % 3, primary);

	const tire = pickTire({ harmony, shuffle, hi, pHue, aHue, softHex: soft, jit });
	return { soft, tire };
}

/**
 * Propose all four target colors while keeping the user's locked slots exactly as given
 * (normalized hex). Unlocked slots are derived from an anchor (primary, else accent, else soft,
 * else tire, else a default blue) with the harmony; `shuffle` 0 is canonical, others are
 * deterministic alternatives. With only a primary locked this matches {@link generateTargets}.
 */
export function generateFromLocked(
	lockedIn: LockedTargets,
	harmony: Harmony,
	shuffle = 0
): PaletteTargets {
	const locked = cleanLocked(lockedIn);
	const anchor = locked.primary ?? locked.accent ?? locked.soft ?? locked.tire ?? DEFAULT_ANCHOR;
	const g = generateTargets(anchor, harmony, shuffle);

	// Only a primary (and maybe soft/tire) locked: the plain generator, with locks laid over it.
	if (locked.primary && !locked.accent) {
		const accent =
			dE(locked.primary, g.accent) < MIN_ACCENT_DE
				? withGap(locked.primary, hexToOklch(g.accent))
				: g.accent;
		return {
			primary: locked.primary,
			accent,
			soft: locked.soft ?? g.soft,
			tire: locked.tire ?? tireApart(g.tire, locked.soft)
		};
	}

	let primary: string;
	let accent: string;
	if (locked.primary && locked.accent) {
		primary = locked.primary;
		accent = locked.accent;
	} else if (locked.accent) {
		// Derive a primary from the accent: generate from it and swap roles.
		accent = locked.accent;
		primary = withGap(accent, hexToOklch(g.accent));
	} else {
		primary = g.primary;
		accent = g.accent;
	}
	const st =
		locked.primary || locked.accent
			? deriveSoftTire(primary, accent, harmony, shuffle)
			: { soft: g.soft, tire: g.tire };
	return {
		primary,
		accent,
		soft: locked.soft ?? st.soft,
		tire: locked.tire ?? tireApart(st.tire, locked.soft)
	};
}

export interface PaletteVariation {
	id: string;
	label: string;
	harmony: Harmony;
	targets: PaletteTargets;
}

/** Variations closer than this (CIEDE2000, every unlocked slot) count as duplicates. */
export const VARIATION_MIN_DE = 6;

/**
 * Distinct variations of the locked colors across harmonies (interleaved per shuffle round) or,
 * with `harmonies`, only those themes. Near-duplicates are skipped; `page` gives the next set.
 * Fewer than `count` come back when the locks leave little room (all four locked: one).
 */
export function paletteVariations(
	lockedIn: LockedTargets,
	count = 6,
	page = 0,
	harmonies: Harmony[] = HARMONIES.map((h) => h.id)
): PaletteVariation[] {
	const locked = cleanLocked(lockedIn);
	const free = SLOTS.filter((s) => !locked[s]);
	const need = (page + 1) * count;
	const kept: PaletteVariation[] = [];
	const maxRounds = 40;
	for (let s = 0; s < maxRounds && kept.length < need; s++) {
		for (const h of harmonies) {
			if (kept.length >= need) break;
			const targets = generateFromLocked(locked, h, s);
			const dup = kept.some((k) =>
				free.every((slot) => dE(k.targets[slot], targets[slot]) < VARIATION_MIN_DE)
			);
			if (dup) continue;
			const label = HARMONIES.find((x) => x.id === h)!.label;
			kept.push({
				id: `${h}-${s}`,
				label: s === 0 ? label : `${label} · ${s + 1}`,
				harmony: h,
				targets
			});
		}
	}
	return kept.slice(page * count, need);
}
