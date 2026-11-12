import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guards the colour tokens in src/app.css: the two dark sets (OS preference and the
// data-theme="dark" attribute) must be identical, and every text/background pair the app uses
// must meet WCAG AA (4.5:1) in both themes.
const css = readFileSync(new URL('../../app.css', import.meta.url), 'utf8');

function block(start: string): string {
	const i = css.indexOf(start);
	if (i < 0) throw new Error(`block not found: ${start}`);
	const open = css.indexOf('{', i);
	let depth = 0;
	for (let j = open; j < css.length; j++) {
		if (css[j] === '{') depth++;
		else if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j);
	}
	throw new Error('unbalanced');
}
function tokens(body: string): Record<string, string> {
	const t: Record<string, string> = {};
	for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) t[m[1]] = m[2];
	return t;
}

const light = tokens(block(':root {\n\t--paper'));
const darkMedia = tokens(block(":root:not([data-theme='light']) {"));
const darkAttr = tokens(block(":root[data-theme='dark'] {"));
const dark = { ...light, ...darkAttr };

function lum(hex: string): number {
	const [r, g, b] = [1, 3, 5]
		.map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

describe('theme tokens', () => {
	it('the data-theme dark set equals the prefers-color-scheme dark set', () => {
		expect(Object.keys(darkAttr).length).toBeGreaterThan(15);
		expect(darkMedia).toEqual(darkAttr);
	});

	const surfaces = ['paper', 'card', 'accent-soft', 'ok-soft', 'warn-soft', 'bad-soft', 'run-soft'];
	const texts = ['ink', 'muted', 'accent', 'ok', 'warn', 'bad', 'run'];
	for (const [name, T] of [
		['light', light],
		['dark', dark]
	] as const) {
		it(`${name}: text tokens on surfaces reach 4.5:1`, () => {
			const low: string[] = [];
			for (const f of texts)
				for (const b of surfaces) {
					// the tone text only appears on its own soft fill, the page and cards
					if (['ok', 'warn', 'bad', 'run'].includes(f) && surfaces.includes(b)) {
						const own = b === `${f}-soft` || b === 'paper' || b === 'card';
						if (!own && b !== 'accent-soft') continue;
					}
					const r = ratio(T[f], T[b]);
					if (r < 4.5) low.push(`${f} on ${b}: ${r.toFixed(2)}`);
				}
			expect(low).toEqual([]);
		});
		it(`${name}: muted text on the --line tag background reaches 4.5:1`, () => {
			expect(ratio(T.muted, T.line)).toBeGreaterThanOrEqual(4.5);
		});
		it(`${name}: the focus ring (accent) reaches 3:1 against every surface it is drawn on`, () => {
			const low = ['paper', 'card', 'accent-soft']
				.map((b) => [b, ratio(T.accent, T[b])] as const)
				.filter(([, r]) => r < 3)
				.map(([b, r]) => `accent on ${b}: ${r.toFixed(2)}`);
			expect(low).toEqual([]);
		});
		it(`${name}: --field-line (text field and select borders) reaches 3:1 on paper and card`, () => {
			// WCAG 1.4.11: the border is the only cue that a field is a field, so it needs 3:1
			// (the decorative --line hairline, about 1.3:1, is for cards and dividers only).
			expect(ratio(T['field-line'], T.paper)).toBeGreaterThanOrEqual(3);
			expect(ratio(T['field-line'], T.card)).toBeGreaterThanOrEqual(3);
		});
		it(`${name}: plate bed labels reach 4.5:1 and bed lines 3:1 on the bed`, () => {
			expect(ratio(T['bed-text'], T.bed)).toBeGreaterThanOrEqual(4.5);
			expect(ratio(T['bed-line'], T.bed)).toBeGreaterThanOrEqual(3);
		});
		it(`${name}: --on-fill on solid accent, ok, bad and run fills reaches 4.5:1`, () => {
			const low = ['accent', 'ok', 'bad', 'run']
				.map((k) => [k, ratio(T['on-fill'], T[k])] as const)
				.filter(([, r]) => r < 4.5)
				.map(([k, r]) => `${k}: ${r.toFixed(2)}`);
			expect(low).toEqual([]);
		});
	}
});
