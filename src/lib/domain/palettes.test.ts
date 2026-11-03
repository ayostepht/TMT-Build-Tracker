import { describe, expect, it } from 'vitest';
import { deltaE, deltaE2000, hexToOklch, isHex, oklchToHex } from './color.ts';
import {
	HARMONIES,
	MIN_ACCENT_DE,
	PALETTES,
	generateTargets,
	nearest,
	paletteSlots,
	resolvePalette,
	type CatalogSwatches,
	type SwatchTuple
} from './palettes.ts';

const petg: SwatchTuple[] = [
	['Overture', 'Blue', '#034e89', 'PETG'],
	['Overture', 'Digital Blue', '#0378d0', 'PETG'],
	['Overture', 'Red', '#c0281e', 'PETG'],
	['Polymaker', 'Navy', '#0a4a8a', 'PETG'],
	['Polymaker', 'White', '#f2f2f2', 'PETG'],
	['Elegoo', 'Carbon Blue', '#034e90', 'PETG-CF'],
	['Overture', 'Green', '#2f6b3a', 'PETG']
];
const tpu: SwatchTuple[] = [
	['Overture', 'Black', '#1c1c20', 'TPU-95A'],
	['Overture', 'Digital Blue', '#0378d0', 'TPU-95A'],
	['Sunlu', 'Grey', '#808080', 'TPU']
];
const catalog: CatalogSwatches = { petg, tpu };

describe('color math', () => {
	it('CIEDE2000 matches published reference pairs', () => {
		// Sharma et al. test data, pair 1 (dE00 = 2.0425) and identical colors.
		expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
		expect(deltaE('#336699', '#336699')).toBeCloseTo(0, 6);
		expect(deltaE('#000000', '#ffffff')).toBeGreaterThan(90);
	});
	it('round-trips OKLCH through hex', () => {
		const o = hexToOklch('#3a7bd5');
		expect(deltaE(oklchToHex(o), '#3a7bd5')).toBeLessThan(1);
	});
});

describe('nearest / resolvePalette', () => {
	it('finds the closest filament', () => {
		expect(nearest('#0378d0', petg)?.colorName).toBe('Digital Blue');
		expect(nearest('#c02020', petg)?.colorName).toBe('Red');
	});
	it('prefers the chosen brand over a slightly closer match elsewhere', () => {
		expect(nearest('#0a4a8a', petg)?.brand).toBe('Polymaker');
		expect(nearest('#0a4a8a', petg, { brand: 'overture' })?.brand).toBe('Overture');
	});
	it('prefers plain PETG over carbon-filled at similar distance', () => {
		expect(nearest('#034e90', petg)?.material).toBe('PETG');
	});
	it('never uses one filament twice and keeps accent clear of primary', () => {
		const r = resolvePalette(
			{ primary: '#034e89', accent: '#034e89', soft: '#1c1c20', tire: '#1c1c20' },
			catalog
		);
		expect(r.primary?.name).not.toBe(r.accent?.name);
		expect(r.soft?.name).not.toBe(r.tire?.name);
		expect(deltaE(r.primary!.hex, r.accent!.hex)).toBeGreaterThanOrEqual(14);
	});
	it('uses PETG for primary/accent and TPU for soft/tire', () => {
		const r = resolvePalette(PALETTES[0].targets, catalog, { brand: 'Overture' });
		expect(r.primary?.material).toBe('PETG');
		expect(r.tire?.material).toBe('TPU-95A');
		expect(r.primary?.name).toBe('Overture Blue');
	});
});

describe('PALETTES', () => {
	it('has unique ids and valid hexes for all four slots', () => {
		expect(PALETTES.length).toBeGreaterThanOrEqual(12);
		expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
		for (const p of PALETTES) {
			expect(p.name && p.description).toBeTruthy();
			for (const h of Object.values(p.targets)) expect(isHex(h)).toBe(true);
		}
		expect(PALETTES[0].name).toBe('Columbus Blues');
	});
});

describe('generateTargets', () => {
	const bases = [
		'#ff0000',
		'#ffd400',
		'#00a86b',
		'#1f4fd8',
		'#8a2be2',
		'#ff69b4',
		'#222222',
		'#f5f5f5',
		'#808080'
	];
	it('keeps primary and accent apart, tires dark, for every harmony and shuffle', () => {
		for (const b of bases)
			for (const h of HARMONIES)
				for (let s = 0; s < 6; s++) {
					const t = generateTargets(b, h.id, s);
					for (const v of Object.values(t)) expect(isHex(v)).toBe(true);
					expect(deltaE(t.primary, t.accent)).toBeGreaterThanOrEqual(MIN_ACCENT_DE - 0.5);
					expect(hexToOklch(t.tire).l).toBeLessThan(0.45);
				}
	});
	it('is deterministic and shuffle gives alternatives', () => {
		expect(generateTargets('#3a7bd5', 'triadic', 2)).toEqual(
			generateTargets('#3a7bd5', 'triadic', 2)
		);
		const a = JSON.stringify(generateTargets('#3a7bd5', 'analogous', 0));
		const b = JSON.stringify(generateTargets('#3a7bd5', 'analogous', 1));
		expect(a).not.toBe(b);
	});
	it('harmonies land on the expected hues', () => {
		const base = hexToOklch('#3a7bd5').h;
		const diff = (x: string) => Math.abs(((hexToOklch(x).h - base + 540) % 360) - 180);
		expect(diff(generateTargets('#3a7bd5', 'complementary').accent)).toBeGreaterThan(130);
		expect(diff(generateTargets('#3a7bd5', 'analogous').accent)).toBeLessThan(60);
		expect(diff(generateTargets('#3a7bd5', 'monochrome').accent)).toBeLessThan(25);
	});
});

describe('paletteSlots', () => {
	it('maps by role key, else by material order', () => {
		expect(
			paletteSlots([
				{ key: 'primary', material: 'PETG' },
				{ key: 'accent', material: 'PETG' },
				{ key: 'soft', material: 'TPU 95A' },
				{ key: 'tire', material: 'TPU 95A' }
			])
		).toEqual({ primary: 'primary', accent: 'accent', soft: 'soft', tire: 'tire' });
		expect(
			paletteSlots([
				{ key: 'a', material: 'PETG' },
				{ key: 'b', material: 'PETG' },
				{ key: 'c', material: 'TPU' }
			])
		).toEqual({ primary: 'a', accent: 'b', soft: 'c' });
	});
});
