// "Share a picture" (issue #99): the pure rules behind the exported chair picture. Sizes, default
// texts, which colors become swatches, a contrast-safe palette for the social layout, text fitting
// and file names. Drawing (canvas) lives in `client/share-picture.ts`. No DOM, Svelte or Node imports.
//
// Privacy: the picture holds only the two typed strings, the chair, plain color swatches and the
// credit. Nothing here ever reads a build, recipient, team, user or filament name.

import { hexToOklch, hexToRgb, isHex, normHex, oklchToHex, deltaE } from './color.ts';
import type { BuildView } from './types.ts';

export type PictureVariant = 'family' | 'social';
export type PictureFormat = 'png' | 'jpeg';

export interface VariantSpec {
	id: PictureVariant;
	label: string;
	/** Export size in pixels. */
	width: number;
	height: number;
	defaultTitle: string;
	defaultLine: string;
	/** Placeholder of the line field (shown while it is empty). */
	linePlaceholder: string;
	/** Small credit printed on the picture. */
	credit: string;
	titleMax: number;
	lineMax: number;
	/** One-line explanation under the layout switch. */
	hint: string;
}

export const VARIANTS: Record<PictureVariant, VariantSpec> = {
	family: {
		id: 'family',
		label: 'For the family',
		width: 1600,
		height: 2000,
		defaultTitle: "Your chair's colors",
		defaultLine: 'Printed colors can look a little different than on a screen.',
		linePlaceholder: 'Optional: a short note',
		credit: 'MakeGood TMT mobility trainer',
		titleMax: 60,
		lineMax: 120,
		hint: 'A calm card to send to a family so they can approve the colors.'
	},
	social: {
		id: 'social',
		label: 'For social media',
		width: 1080,
		height: 1080,
		defaultTitle: "We're building a TMT chair",
		defaultLine: '',
		linePlaceholder: 'Chapter name, or what you are asking for',
		credit: 'MakeGood TMT mobility trainer · open design by MakeGood',
		titleMax: 50,
		lineMax: 90,
		hint: 'A square picture for a feed, in your chair’s own colors.'
	}
};

export const VARIANT_IDS: PictureVariant[] = ['family', 'social'];

export const MAX_SWATCHES = 6;
export const JPEG_QUALITY = 0.92;

export function mimeOf(format: PictureFormat): 'image/png' | 'image/jpeg' {
	return format === 'png' ? 'image/png' : 'image/jpeg';
}

/** `tmt-chair-family.png`, `tmt-chair-social.jpg`. */
export function pictureFileName(variant: PictureVariant, format: PictureFormat): string {
	return `tmt-chair-${variant}.${format === 'png' ? 'png' : 'jpg'}`;
}

/**
 * A typed string as it goes on the picture: one line, single spaces, trimmed, capped at `max`
 * characters (code points, so an emoji is never cut in half).
 */
export function cleanText(s: string, max: number): string {
	const t = s.replace(/\s+/g, ' ').trim();
	const chars = Array.from(t);
	return chars.length > max ? chars.slice(0, max).join('').trimEnd() : t;
}

// ---- swatches ---------------------------------------------------------------------------

/**
 * The distinct colors in use on the chair: visible (active) parts only, most used first.
 * `colors` is part slug → hex as the 3D view shows it (`designColors`). Colors that look the same
 * (ΔE2000 below `merge`) count as one, the more used one wins. At most `limit` come back.
 */
export function swatchColors(
	view: Pick<BuildView, 'parts'>,
	colors: Record<string, string>,
	limit = MAX_SWATCHES,
	merge = 3
): string[] {
	const count = new Map<string, number>();
	const first = new Map<string, number>();
	view.parts.forEach((p, i) => {
		const raw = colors[p.slug];
		if (!raw || !isHex(raw)) return;
		const hex = normHex(raw);
		count.set(hex, (count.get(hex) ?? 0) + 1);
		if (!first.has(hex)) first.set(hex, i);
	});
	const sorted = [...count.keys()].sort(
		(a, b) => count.get(b)! - count.get(a)! || first.get(a)! - first.get(b)!
	);
	const out: string[] = [];
	for (const hex of sorted) {
		if (out.some((o) => deltaE(o, hex) < merge)) continue;
		out.push(hex);
		if (out.length >= limit) break;
	}
	return out;
}

// ---- contrast ---------------------------------------------------------------------------

function luminance(hex: string): number {
	const lin = hexToRgb(hex).map((v) => {
		const s = v / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio of two colors, 1..21. */
export function contrastRatio(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface SocialPalette {
	/** Background of the whole picture. */
	bg: string;
	/** Headline and credit text on `bg`. */
	text: string;
	/** Secondary line on `bg`. */
	muted: string;
	/** Light panel the chair stands on. */
	panel: string;
	/** Accent bar / rule on `bg`. */
	accent: string;
}

const WHITE = '#ffffff';
const INK = '#16181d';

/**
 * Colors for the social layout, derived from the chair's own colors: a deep tone of the most
 * prominent chromatic color (any neutral chair falls back to a calm slate), white text on it, and a
 * light tinted panel for the chair. The text contrast is computed, not assumed: the background is
 * darkened until white text reaches `min`.
 */
export function socialPalette(swatches: string[], min = 4.5): SocialPalette {
	// First chromatic swatch wins (swatches are most-used first); neutrals only if nothing else.
	const base = swatches.find((h) => hexToOklch(h).c >= 0.05) ?? null;
	const o = base ? hexToOklch(base) : { l: 0.4, c: 0.03, h: 255 };
	const hue = base ? o.h : 255;
	const chroma = Math.min(base ? o.c : 0.03, 0.11);
	let l = 0.34;
	let bg = oklchToHex({ l, c: chroma, h: hue });
	while (contrastRatio(WHITE, bg) < min && l > 0.05) {
		l -= 0.02;
		bg = oklchToHex({ l, c: chroma, h: hue });
	}
	const accent = oklchToHex({ l: 0.82, c: Math.min(chroma * 1.4, 0.13), h: hue });
	let muted = oklchToHex({ l: 0.9, c: Math.min(chroma * 0.3, 0.03), h: hue });
	if (contrastRatio(muted, bg) < min) muted = WHITE;
	return {
		bg,
		text: WHITE,
		muted,
		panel: oklchToHex({ l: 0.965, c: Math.min(chroma * 0.18, 0.02), h: hue }),
		accent
	};
}

/** Ink or white, whichever reads better on `bg` (≥ 4.5 whenever one of them can). */
export function readableOn(bg: string): string {
	return contrastRatio(WHITE, bg) >= contrastRatio(INK, bg) ? WHITE : INK;
}

// ---- text fitting -----------------------------------------------------------------------

export interface FitOptions {
	/** Font sizes to try, largest first. */
	sizes: number[];
	/** Widest a line may be. */
	maxWidth: number;
	/** Lines allowed (default 2). */
	maxLines?: number;
}

export interface FittedText {
	lines: string[];
	size: number;
	/** The text did not fit even at the smallest size and was cut with an ellipsis. */
	truncated: boolean;
}

const ELLIPSIS = '…';

function graphemes(s: string): string[] {
	const Seg = (
		Intl as unknown as {
			Segmenter?: new (
				l?: string,
				o?: { granularity: 'grapheme' }
			) => { segment(s: string): Iterable<{ segment: string }> };
		}
	).Segmenter;
	if (Seg)
		return [...new Seg(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);
	return Array.from(s);
}

/** Cut `s` (by characters) so `s + …` fits in `maxWidth`. */
function ellipsize(s: string, measure: (t: string) => number, maxWidth: number): string {
	const g = graphemes(s);
	let n = g.length;
	while (n > 0 && measure(g.slice(0, n).join('').trimEnd() + ELLIPSIS) > maxWidth) n--;
	return g.slice(0, n).join('').trimEnd() + ELLIPSIS;
}

/** Break `text` into lines of at most `maxWidth` at `size`; null when it needs more than `maxLines`. */
function wrap(
	text: string,
	size: number,
	measure: (t: string, size: number) => number,
	maxWidth: number,
	maxLines: number
): string[] | null {
	const m = (t: string) => measure(t, size);
	const lines: string[] = [];
	let cur = '';
	// A "word" wider than a line is split by characters (long names, no-space scripts).
	const pieces: string[] = [];
	for (const w of text.split(' ').filter(Boolean)) {
		if (m(w) <= maxWidth) {
			pieces.push(w);
			continue;
		}
		let chunk = '';
		for (const ch of graphemes(w)) {
			if (chunk && m(chunk + ch) > maxWidth) {
				pieces.push(chunk);
				chunk = '';
			}
			chunk += ch;
		}
		if (chunk) pieces.push(chunk);
	}
	for (const w of pieces) {
		const next = cur ? `${cur} ${w}` : w;
		if (!cur || m(next) <= maxWidth) cur = next;
		else {
			lines.push(cur);
			cur = w;
		}
		if (lines.length > maxLines) return null;
	}
	if (cur) lines.push(cur);
	return lines.length <= maxLines ? lines : null;
}

/**
 * Fit `text` into at most `maxLines` lines: the largest size that wraps within the limit wins; if
 * none does, the smallest size is used and the last line ends in an ellipsis. `measure(text, size)`
 * returns the rendered width (canvas `measureText`). Empty text gives no lines.
 */
export function fitText(
	text: string,
	measure: (t: string, size: number) => number,
	opts: FitOptions
): FittedText {
	const maxLines = opts.maxLines ?? 2;
	const t = text.replace(/\s+/g, ' ').trim();
	const sizes = opts.sizes.length ? opts.sizes : [16];
	if (!t) return { lines: [], size: sizes[0], truncated: false };
	for (const size of sizes) {
		const lines = wrap(t, size, measure, opts.maxWidth, maxLines);
		if (lines) return { lines, size, truncated: false };
	}
	const size = sizes[sizes.length - 1];
	const m = (s: string) => measure(s, size);
	// Over the limit at the smallest size: fill the lines greedily, ellipsize the rest into the last one.
	const words = t.split(' ');
	const lines: string[] = [];
	let i = 0;
	for (let ln = 0; ln < maxLines && i < words.length; ln++) {
		const last = ln === maxLines - 1;
		let cur = '';
		while (i < words.length) {
			const next = cur ? `${cur} ${words[i]}` : words[i];
			if (!last && cur && m(next) > opts.maxWidth) break;
			if (!last && !cur && m(next) > opts.maxWidth) {
				// one long word on a non-final line: cut it at the line end and carry the rest on
				const g = graphemes(words[i]);
				let n = g.length;
				while (n > 1 && m(g.slice(0, n).join('')) > opts.maxWidth) n--;
				cur = g.slice(0, n).join('');
				words[i] = g.slice(n).join('');
				if (!words[i]) i++;
				break;
			}
			if (last && cur && m(next) > opts.maxWidth) break;
			cur = next;
			i++;
		}
		lines.push(cur);
	}
	const rest = i < words.length;
	const lastIdx = lines.length - 1;
	if (rest || m(lines[lastIdx]) > opts.maxWidth) {
		const tail = lines[lastIdx] + (rest ? ' ' + words.slice(i).join(' ') : '');
		lines[lastIdx] = ellipsize(tail, m, opts.maxWidth);
	}
	return { lines, size, truncated: true };
}
