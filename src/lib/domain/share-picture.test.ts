import { describe, expect, it } from 'vitest';
import {
	VARIANTS,
	cleanText,
	contrastRatio,
	fitText,
	mimeOf,
	pictureFileName,
	readableOn,
	socialPalette,
	swatchColors
} from './share-picture.ts';
import { designColors } from './design.ts';
import { makeView } from './fixtures.ts';

// 10 px per character, whatever the size scale: deterministic.
const mono = (t: string, size: number) => Array.from(t).length * (size / 2);

describe('variants and files', () => {
	it('has the two layouts at the decided sizes', () => {
		expect([VARIANTS.family.width, VARIANTS.family.height]).toEqual([1600, 2000]);
		expect([VARIANTS.social.width, VARIANTS.social.height]).toEqual([1080, 1080]);
		expect(VARIANTS.family.defaultTitle).toBe("Your chair's colors");
		expect(VARIANTS.social.defaultLine).toBe('');
	});
	it('names files and mime types', () => {
		expect(pictureFileName('family', 'png')).toBe('tmt-chair-family.png');
		expect(pictureFileName('social', 'jpeg')).toBe('tmt-chair-social.jpg');
		expect(mimeOf('jpeg')).toBe('image/jpeg');
		expect(mimeOf('png')).toBe('image/png');
	});
	it('never carries a name from the build in its defaults', () => {
		const all = JSON.stringify(VARIANTS);
		expect(all).not.toMatch(/recipient|hospital|team|filament/i);
	});
});

describe('cleanText', () => {
	it('collapses whitespace and caps by characters, not UTF-16 units', () => {
		expect(cleanText('  a \n  b  ', 10)).toBe('a b');
		expect(cleanText('😀😀😀😀', 2)).toBe('😀😀');
		expect(cleanText('x'.repeat(100), 60)).toHaveLength(60);
	});
});

describe('swatchColors', () => {
	const view = makeView();
	it('lists distinct colors of visible parts, most used first, no more than the limit', () => {
		const colors = designColors(view);
		const sw = swatchColors(view, colors);
		expect(new Set(sw).size).toBe(sw.length);
		expect(sw.length).toBeLessThanOrEqual(6);
		const counts = (h: string) =>
			view.parts.filter((p) => colors[p.slug]?.toLowerCase() === h).length;
		for (let i = 1; i < sw.length; i++)
			expect(counts(sw[i - 1])).toBeGreaterThanOrEqual(counts(sw[i]));
	});
	it('ignores hidden (inactive) parts and merges look-alikes', () => {
		const parts = view.parts.slice(0, 3);
		const colors: Record<string, string> = {
			[parts[0].slug]: '#112233',
			[parts[1].slug]: '#112334',
			[parts[2].slug]: '#ffffff'
		};
		for (const p of view.allParts) if (!(p.slug in colors)) colors[p.slug] = '#ff0000';
		expect(swatchColors({ parts }, colors)).toEqual(['#112233', '#ffffff']);
		expect(swatchColors({ parts: [] }, colors)).toEqual([]);
	});
});

describe('socialPalette', () => {
	const sets = [
		[],
		['#ffffff'],
		['#000000'],
		['#ffeb3b', '#ffffff'],
		['#ff0000', '#00ff00'],
		['#00e5ff'],
		['#7a1fa2', '#ffd000'],
		['#fdd835', '#f8bbd0']
	];
	it('keeps text at 4.5:1 or better on the background whatever the colors are', () => {
		for (const s of sets) {
			const p = socialPalette(s);
			expect(contrastRatio(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(p.muted, p.bg)).toBeGreaterThanOrEqual(4.5);
		}
	});
	it('readableOn picks the better of ink and white', () => {
		expect(readableOn('#000000')).toBe('#ffffff');
		expect(readableOn('#ffffff')).toBe('#16181d');
		expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
	});
});

describe('fitText', () => {
	const o = { sizes: [100, 80, 60], maxWidth: 400 };
	it('returns nothing for empty text', () => {
		expect(fitText('  ', mono, o).lines).toEqual([]);
	});
	it('keeps a short title on one line at the largest size', () => {
		const r = fitText('Hello', mono, o);
		expect(r).toEqual({ lines: ['Hello'], size: 100, truncated: false });
	});
	it('wraps to two lines, then shrinks a step before cutting', () => {
		const t = 'one two three four five six'; // 27 chars
		const r = fitText(t, mono, o);
		expect(r.lines.length).toBeLessThanOrEqual(2);
		expect(r.truncated).toBe(false);
		expect(r.size).toBeLessThan(100);
		for (const l of r.lines) expect(mono(l, r.size)).toBeLessThanOrEqual(400);
	});
	it('ends in an ellipsis when nothing fits, never wider than the box', () => {
		const t = 'word '.repeat(60);
		const r = fitText(t, mono, o);
		expect(r.truncated).toBe(true);
		expect(r.lines).toHaveLength(2);
		expect(r.lines[1].endsWith('…')).toBe(true);
		for (const l of r.lines) expect(mono(l, r.size)).toBeLessThanOrEqual(400);
	});
	it('breaks one very long word and handles emoji and no-space scripts', () => {
		for (const t of ['x'.repeat(200), '😀'.repeat(80), '你好世界'.repeat(30)]) {
			const r = fitText(t, mono, o);
			expect(r.lines.length).toBeLessThanOrEqual(2);
			for (const l of r.lines) expect(mono(l, r.size)).toBeLessThanOrEqual(400);
		}
	});
});
