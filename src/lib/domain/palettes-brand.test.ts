import { describe, expect, it } from 'vitest';
import { swatches } from '../server/filaments/index.ts';
import { hexToOklch } from './color.ts';
import {
	BRAND_MARGIN_DE,
	BRAND_OK_DE,
	generateFromLocked,
	nearest,
	resolvePalette,
	type CatalogSwatches,
	type SwatchTuple
} from './palettes.ts';

const real: CatalogSwatches = { petg: swatches('petg'), tpu: swatches('tpu') };
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('preferred brand versus a much closer match', () => {
	it('does not take Sunlu Purple for a blue accent when another brand has a near-exact blue', () => {
		const blue = '#1e88e5';
		const m = nearest(blue, real.petg, { brand: 'Sunlu' });
		expect(m).toBeTruthy();
		expect(hueGap(hexToOklch(m!.hex).h, hexToOklch(blue).h)).toBeLessThan(30);
		expect(m!.relaxed).toBe(true);
		expect(m!.relaxedReason).toMatch(/No close Sunlu match; using /);
		// The unbranded best is far closer than the old pick (ΔE 21).
		expect(m!.de).toBeLessThan(10);
	});
	it('still prefers the brand when it is close enough', () => {
		const m = nearest('#e53935', real.petg, { brand: 'Sunlu' });
		expect(m?.brand).toBe('Sunlu');
		expect(m!.de).toBeLessThanOrEqual(Math.max(BRAND_OK_DE, BRAND_MARGIN_DE));
		expect(m!.relaxed).toBeFalsy();
	});
	it('a locked red + blue palette resolves to red and blue with Sunlu preferred', () => {
		const locked = { primary: '#e53935', accent: '#1e88e5' };
		for (const h of ['complementary', 'analogous', 'triadic', 'contrast'] as const) {
			const t = generateFromLocked(locked, h, 0);
			const r = resolvePalette(t, real, { brand: 'Sunlu' });
			expect(hueGap(hexToOklch(r.accent!.hex).h, hexToOklch(locked.accent).h)).toBeLessThan(30);
			expect(hueGap(hexToOklch(r.primary!.hex).h, hexToOklch(locked.primary).h)).toBeLessThan(30);
		}
	});
});

describe('several preferred brands', () => {
	const blue = '#1e88e5';
	it('Sunlu + Overture: the blue case still avoids Sunlu Purple, and names the set', () => {
		const m = nearest(blue, real.petg, { brands: ['Sunlu', 'Overture'] });
		expect(m).toBeTruthy();
		expect(hueGap(hexToOklch(m!.hex).h, hexToOklch(blue).h)).toBeLessThan(30);
		if (m!.relaxed) expect(m!.relaxedReason).toMatch(/^No close match in Sunlu, Overture; using /);
		else expect(['sunlu', 'overture']).toContain(m!.brand.toLowerCase());
	});
	it('any listed brand counts as preferred', () => {
		const items: SwatchTuple[] = [
			['Alpha', 'Red', '#e53935', 'PETG'],
			['Beta', 'Red', '#e63a36', 'PETG'],
			['Gamma', 'Red', '#e53935', 'PETG']
		];
		expect(nearest('#e53935', items, { brands: ['Beta', 'Gamma'] })?.brand).toBe('Gamma');
		expect(nearest('#e63a36', items, { brands: ['beta', 'Alpha'] })?.brand).toBe('Beta');
		expect(nearest('#e53935', items, { brands: [] })?.brand).toBe('Alpha');
	});
	it('a single listed brand behaves like the old option', () => {
		expect(nearest('#e53935', real.petg, { brands: ['Sunlu'] })).toEqual(
			nearest('#e53935', real.petg, { brand: 'Sunlu' })
		);
		const far = nearest(blue, real.petg, { brands: ['Sunlu'] });
		expect(far!.relaxedReason).toMatch(/No close Sunlu match; using /);
	});
	it('resolvePalette accepts a brand list', () => {
		const t = generateFromLocked({ primary: '#e53935', accent: blue }, 'complementary', 0);
		const r = resolvePalette(t, real, { brands: ['Sunlu', 'Overture'] });
		expect(Object.keys(r)).toHaveLength(4);
	});
});
