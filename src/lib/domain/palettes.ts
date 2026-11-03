/**
 * Color palettes for the TMT's four base slots (pure): curated pre-made ones, a harmony
 * based generator, and the matcher that maps target colors to the nearest real catalog
 * filaments (CIEDE2000, preferring a brand and plain PETG / TPU 95A).
 */
import { materialFamily, suggestName } from '../filament-catalog.ts';
import {
	deltaE2000,
	hexToLab,
	hexToOklch,
	isNeutral,
	oklchToHex,
	type Lab,
	type Oklch
} from './color.ts';

/** Compact catalog entry as served by `/api/filaments/swatches`: brand, color name, #hex, material. */
export type SwatchTuple = [brand: string, name: string, hex: string, material: string];

export const SLOTS = ['primary', 'accent', 'soft', 'tire'] as const;
export type SlotKey = (typeof SLOTS)[number];
export type PaletteTargets = Record<SlotKey, string>;

export const SLOT_LABEL: Record<SlotKey, string> = {
	primary: 'Primary',
	accent: 'Accent',
	soft: 'Soft (TPU)',
	tire: 'Tires (TPU)'
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
		'The original: deep blue frame, bright blue accents, black tires.',
		'#034e89',
		'#0378d0',
		'#0378d0',
		'#1c1c20'
	),
	P(
		'ocean',
		'Ocean',
		'Teal and aqua, like a shallow reef.',
		'#0e7c86',
		'#7fd6e8',
		'#2aa5c7',
		'#14202b'
	),
	P(
		'sunset',
		'Sunset',
		'Warm orange frame with golden accents.',
		'#e8553d',
		'#ffb347',
		'#f0788f',
		'#2a1f24'
	),
	P(
		'forest',
		'Forest',
		'Deep green with fresh leaf accents.',
		'#2f6b3a',
		'#a3c46b',
		'#6b8f4e',
		'#1d1f1a'
	),
	P(
		'candy',
		'Candy',
		'Bubblegum pink, sky blue and lilac. Very toddler.',
		'#ff5fa2',
		'#5fd3ff',
		'#b388ff',
		'#2b2b33'
	),
	P(
		'galaxy',
		'Galaxy',
		'Midnight purple with cyan and violet glow.',
		'#2a1b5e',
		'#36d1dc',
		'#7a4dff',
		'#111118'
	),
	P(
		'fire-truck',
		'Fire Truck',
		'Engine red, white trim, safety yellow.',
		'#d31f26',
		'#f2f2f2',
		'#ffc20e',
		'#111111'
	),
	P(
		'mono-graphite',
		'Mono Graphite',
		'Understated grays, easy on the eye.',
		'#3a3d44',
		'#c9ccd2',
		'#8a8f99',
		'#17181b'
	),
	P(
		'pastel',
		'Pastel',
		'Soft pink, baby blue and lavender.',
		'#f4a6c1',
		'#a8d8ea',
		'#c3b1e1',
		'#5a5a66'
	),
	P(
		'superhero',
		'Superhero',
		'Hero blue, cape red and a yellow flash.',
		'#1f4fd8',
		'#e11d2e',
		'#ffd400',
		'#111111'
	),
	P(
		'princess-pink',
		'Princess Pink',
		'Rose pink, gold trim and lilac.',
		'#ec6fa6',
		'#f9d36b',
		'#c58ce6',
		'#4a2c4f'
	),
	P(
		'camo',
		'Camo',
		'Olive and tan with dark green tires.',
		'#5a6b3c',
		'#8b7355',
		'#3f4a2c',
		'#1e1e1a'
	),
	P(
		'sunshine',
		'Sunshine',
		'Happy yellow with sky blue.',
		'#f7c52b',
		'#3aa0e0',
		'#ff9f43',
		'#222226'
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
}

export interface MatchOptions {
	/** Brand to prefer (case-insensitive); a small penalty for others, not a hard filter. */
	brand?: string;
	/** Entries already used by another slot. */
	exclude?: Set<string>;
	/** Colors the match must stay clear of (the primary when matching the accent). */
	avoid?: { hex: string; minDe: number }[];
}

const BRAND_PENALTY = 12;

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

/** Multi-color, glitter and similar products whose single catalog hex misleads. */
const GIMMICK =
	/rainbow|gradient|multi|tri-?colou?r|dual|marble|galaxy|sparkle|glitter|glow|chameleon/i;
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

/** Extra distance for exotic variants: carbon/glass-filled, odd hardness, engineering blends. */
function materialPenalty(material: string): number {
	const m = material
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, '-');
	if (/-(cf|gf)/.test(m)) return 9;
	switch (materialFamily(m)) {
		case 'petg':
			return m === 'petg' ? 0 : 5;
		case 'tpu':
			return m === 'tpu' || m === 'tpu-95a' ? 0 : 4;
		default:
			return 8;
	}
}

export function nearest(
	target: string,
	items: SwatchTuple[],
	opts: MatchOptions = {}
): Match | null {
	const t = hexToLab(target);
	const L = labsOf(items);
	const want = opts.brand?.trim().toLowerCase();
	const avoid = (opts.avoid ?? []).map((a) => ({ lab: hexToLab(a.hex), min: a.minDe }));
	let best = -1;
	let bestScore = Infinity;
	let bestDe = 0;
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		if (opts.exclude?.has(tupleKey(it))) continue;
		if (avoid.some((a) => deltaE2000(L[i], a.lab) < a.min)) continue;
		const de = deltaE2000(t, L[i]);
		const score =
			de +
			(GIMMICK.test(it[1]) ? 15 : 0) +
			materialPenalty(it[3]) * 0.5 +
			(want
				? it[0].toLowerCase() !== want
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
	opts: { brand?: string } = {}
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
		const m = nearest(targets[slot], items, { brand: opts.brand, exclude: used, avoid });
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

	// Soft TPU follows the accent; the variants keep "shuffle" interesting.
	const sv = shuffle % 3;
	const soft =
		sv === 0
			? accent
			: sv === 1
				? hex({ ...hexToOklch(accent), l: Math.min(0.9, hexToOklch(accent).l + 0.1) })
				: hex({ l: clamp(p.l + 0.12, 0.45, 0.88), c: Math.max(p.c * 0.9, 0.06), h: hue + 20 });

	// Tires: near black unless the theme asks for something gentler.
	const tv = shuffle % 3;
	let tire: Oklch = { l: 0.22, c: 0.01, h: 270 };
	if (harmony === 'contrast') tire = { l: 0.18, c: 0.005, h: 270 };
	else if (harmony === 'soft') tire = { l: 0.4, c: 0.015, h: 270 };
	else if (harmony === 'monochrome') tire = { l: 0.24, c: 0.035, h: hue };
	if (shuffle > 0 && harmony !== 'contrast') {
		if (tv === 1) tire = { l: 0.32, c: 0.012, h: 270 };
		else if (tv === 2) tire = { l: 0.25, c: 0.04, h: hue };
	}
	return { primary, accent, soft, tire: hex(tire) };
}
