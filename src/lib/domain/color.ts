// Color math (pure): hex <-> sRGB <-> OKLab/OKLCH <-> CIELAB, CIEDE2000 distance, hue sorting.

export type RGB = [number, number, number]; // 0..255
export type Lab = [number, number, number];
export interface Oklch {
	l: number; // 0..1
	c: number; // 0..~0.4
	h: number; // degrees 0..360
}

export function isHex(s: string): boolean {
	return /^#?[0-9a-fA-F]{6}$/.test(s);
}

export function normHex(s: string): string {
	const t = s.trim().replace(/^#/, '').toLowerCase();
	return `#${t}`;
}

export function hexToRgb(hex: string): RGB {
	const t = hex.replace(/^#/, '');
	const n = parseInt(t.length === 3 ? t.replace(/./g, '$&$&') : t, 16) || 0;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
	const h = (v: number) =>
		Math.max(0, Math.min(255, Math.round(v)))
			.toString(16)
			.padStart(2, '0');
	return `#${h(r)}${h(g)}${h(b)}`;
}

const toLin = (v: number) => {
	const s = v / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function hexToLab(hex: string): Lab {
	const [r, g, b] = hexToRgb(hex).map(toLin);
	const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
	const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
	const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
	const fx = f(x);
	const fy = f(y);
	const fz = f(z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** CIEDE2000 color difference between two CIELAB colors. */
export function deltaE2000(a: Lab, b: Lab): number {
	const [L1, a1, b1] = a;
	const [L2, a2, b2] = b;
	const C1 = Math.hypot(a1, b1);
	const C2 = Math.hypot(a2, b2);
	const Cm = (C1 + C2) / 2;
	const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
	const a1p = (1 + G) * a1;
	const a2p = (1 + G) * a2;
	const C1p = Math.hypot(a1p, b1);
	const C2p = Math.hypot(a2p, b2);
	const hp = (y: number, x: number) =>
		x === 0 && y === 0 ? 0 : (deg(Math.atan2(y, x)) + 360) % 360;
	const h1p = hp(b1, a1p);
	const h2p = hp(b2, a2p);
	const dLp = L2 - L1;
	const dCp = C2p - C1p;
	let dhp = 0;
	if (C1p * C2p !== 0) {
		dhp = h2p - h1p;
		if (dhp > 180) dhp -= 360;
		else if (dhp < -180) dhp += 360;
	}
	const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
	const Lpm = (L1 + L2) / 2;
	const Cpm = (C1p + C2p) / 2;
	let hpm = h1p + h2p;
	if (C1p * C2p !== 0) {
		if (Math.abs(h1p - h2p) <= 180) hpm = (h1p + h2p) / 2;
		else hpm = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
	}
	const T =
		1 -
		0.17 * Math.cos(rad(hpm - 30)) +
		0.24 * Math.cos(rad(2 * hpm)) +
		0.32 * Math.cos(rad(3 * hpm + 6)) -
		0.2 * Math.cos(rad(4 * hpm - 63));
	const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
	const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
	const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
	const Sc = 1 + 0.045 * Cpm;
	const Sh = 1 + 0.015 * Cpm * T;
	const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
	return Math.sqrt(
		(dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)
	);
}

export function deltaE(hexA: string, hexB: string): number {
	return deltaE2000(hexToLab(hexA), hexToLab(hexB));
}

// ---- OKLab / OKLCH (used for generating and sorting; perceptually even hue and lightness)

export function hexToOklch(hex: string): Oklch {
	const [R, G, B] = hexToRgb(hex).map(toLin);
	const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
	const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
	const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return { l: L, c: Math.hypot(a, b), h: (deg(Math.atan2(b, a)) + 360) % 360 };
}

function oklchToLinear({ l, c, h }: Oklch): RGB {
	const a = c * Math.cos(rad(h));
	const b = c * Math.sin(rad(h));
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
	];
}

const inGamut = (rgb: RGB) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** OKLCH to hex; chroma is reduced until the color fits in sRGB. */
export function oklchToHex(o: Oklch): string {
	let c = Math.max(0, o.c);
	const l = Math.max(0, Math.min(1, o.l));
	const h = ((o.h % 360) + 360) % 360;
	for (let i = 0; i < 24; i++) {
		const lin = oklchToLinear({ l, c, h });
		if (inGamut(lin)) return rgbToHex(lin.map((v) => fromLin(Math.max(0, Math.min(1, v)))) as RGB);
		c *= 0.92;
	}
	return rgbToHex(
		oklchToLinear({ l, c: 0, h }).map((v) => fromLin(Math.max(0, Math.min(1, v)))) as RGB
	);
}

/** Below this OKLCH chroma a color reads as a neutral (white, gray, black). */
export const NEUTRAL_CHROMA = 0.04;

export function isNeutral(hex: string): boolean {
	return hexToOklch(hex).c < NEUTRAL_CHROMA;
}

/** Sort key for swatch grids: neutrals first by lightness, then hue bands, light to dark inside a band. */
export function hueSortKey(hex: string, bands = 18): number {
	const { l, c, h } = hexToOklch(hex);
	if (c < NEUTRAL_CHROMA) return (1 - l) * 0.99; // 0..1: white first, black last
	const band = Math.floor(((h + 360 / bands / 2) % 360) / (360 / bands));
	return 1 + band + (1 - l) * 0.99;
}

export function compareByHue(a: string, b: string): number {
	return hueSortKey(a) - hueSortKey(b);
}

/** Readable text color (black or white) on top of a background. */
export function onColor(hex: string): '#000000' | '#ffffff' {
	return hexToOklch(hex).l > 0.62 ? '#000000' : '#ffffff';
}
