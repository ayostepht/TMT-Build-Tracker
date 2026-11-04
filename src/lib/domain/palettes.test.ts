import { describe, expect, it } from 'vitest';
import { deltaE, deltaE2000, hexToOklch, isHex, oklchToHex } from './color.ts';
import { swatches as serverSwatches } from '../server/filaments/index.ts';
import { materialFamily } from '../filament-catalog.ts';
import {
	ALLOWED_TPU_HARDNESS,
	EXCLUDED_FILAMENTS,
	HARMONIES,
	MAX_STANDARD_DE,
	MIN_ACCENT_DE,
	PALETTES,
	SLOTS,
	exclusionReason,
	generateTargets,
	isAllowedFilament,
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

// ---- real catalog: only structural-grade filaments

/** The real endpoint's tuples (with flags), so these tests cover the server's flag output too. */
const realSwatches = (family: 'petg' | 'tpu'): SwatchTuple[] => serverSwatches(family);
const real: CatalogSwatches = { petg: realSwatches('petg'), tpu: realSwatches('tpu') };
const label = (m: { brand: string; colorName: string; material: string }) =>
	`${m.brand} ${m.colorName} (${m.material})`;

describe('excluded filaments', () => {
	const bad = (name: string, material = 'PETG', flags?: string): SwatchTuple =>
		flags ? ['X', name, '#808080', material, flags] : ['X', name, '#808080', material];
	it('rejects each excluded kind by name, material or flag', () => {
		const cases: SwatchTuple[] = [
			bad('Matte Black'),
			bad('Black Matt'),
			bad('Silk Black'),
			bad('Silk Blue', 'PLA'),
			bad('Transparent Orange'),
			bad('Translucent Red'),
			bad('Tansparent Blue', 'TPU-95A'),
			bad('Clear'),
			bad('Glow Green'),
			bad('Marble Grey'),
			bad('Wood Brown'),
			bad('Sparkle Red'),
			bad('Glitter Gold'),
			bad('Galaxy Blue'),
			bad('Rainbow'),
			bad('Dual Color Red/Blue'),
			bad('Tri-Color'),
			bad('Multicolor'),
			bad('Blue', 'PETG-CF'),
			bad('Blue', 'PETG-GF'),
			bad('Blue CF'),
			bad('Carbon Fiber Black'),
			bad('Blue', 'PETG', 'matte'),
			bad('Blue', 'PETG', 'translucent'),
			bad('Blue', 'PETG', 'glow'),
			bad('Blue', 'PETG', 'multi'),
			bad('Blue', 'PETG', 'silk'),
			bad('Rock White'),
			bad('Terrazzo Grey'),
			bad('Speckled Black'),
			bad('Granite'),
			bad('Grey', 'TPU-90A'),
			bad('Grey', 'TPU-85A'),
			bad('Grey', 'TPU-98A'),
			bad('Grey', 'TPU-64D'),
			bad('Grey 90A', 'TPU'),
			bad('PolyFlex TPU90 Grey', 'TPU'),
			bad('Foaming Grey', 'TPU'),
			bad('FLEX Navy Blue - Medium', 'TPU'),
			bad('FLEX Soft Red', 'TPU'),
			bad('For AMS Blue', 'TPU')
		];
		for (const c of cases) expect(isAllowedFilament(c), c.join('|')).toBe(false);
		expect(EXCLUDED_FILAMENTS.length).toBeGreaterThan(8);
	});
	it('keeps plain colors, brand names that merely contain the letters, and 95A / unspecified TPU', () => {
		for (const c of [
			bad('Blue'),
			bad('Carbon Black'),
			bad('Metallic Blue'),
			bad('Slate Grey'),
			bad('Rocket Red'),
			bad('High Speed Red'),
			bad('Wood Stain Free Grey'.replace('Wood ', '')),
			bad('Black', 'TPU'),
			bad('Black', 'TPU-95A'),
			bad('Black 95A', 'TPU'),
			['Matter3D', 'Black', '#000000', 'PETG']
		] as SwatchTuple[])
			expect(exclusionReason(c), c.join('|')).toBe('');
	});
	it('matte is allowed only in the relaxed tier, silk and filled never', () => {
		expect(isAllowedFilament(bad('Matte Blue'), true)).toBe(true);
		expect(isAllowedFilament(bad('Silk Blue'), true)).toBe(false);
		expect(isAllowedFilament(bad('Blue', 'PETG', 'silk'), true)).toBe(false);
		expect(isAllowedFilament(bad('Blue', 'PETG', 'matte'), true)).toBe(true);
		expect(isAllowedFilament(bad('Clear'), true)).toBe(false);
		expect(isAllowedFilament(bad('Blue', 'PETG-CF'), true)).toBe(false);
	});
});

describe('relaxed fallback', () => {
	const only = (items: SwatchTuple[]) => nearest('#d31f26', items);
	it('is not relaxed when a standard filament is close', () => {
		const m = nearest('#c0281e', petg);
		expect(m?.relaxed).toBeUndefined();
	});
	it('falls back to another brand, flagged', () => {
		const items: SwatchTuple[] = [
			['Overture', 'Teal', '#008080', 'PETG'],
			['Polymaker', 'Red', '#d31f26', 'PETG']
		];
		const m = nearest('#d31f26', items, { brand: 'Overture' });
		expect(m?.brand).toBe('Polymaker');
		expect(m?.relaxed).toBe(true);
		expect(m?.relaxedReason).toContain('Polymaker Red');
	});
	it('falls back to matte when nothing standard is close, but never to silk or transparent', () => {
		const items: SwatchTuple[] = [
			['A', 'Teal', '#008080', 'PETG'],
			['A', 'Matte Red', '#d31f26', 'PETG'],
			['A', 'Silk Red', '#d31f27', 'PETG'],
			['A', 'Transparent Red', '#d31f28', 'PETG', 'translucent']
		];
		const m = only(items);
		expect(m?.colorName).toBe('Matte Red');
		expect(m?.relaxed).toBe(true);
		expect(m?.relaxedReason).toMatch(/matte/i);
	});
	it('flags a far match as relaxed and returns null when only excluded items exist', () => {
		const far = nearest('#d31f26', [['A', 'Teal', '#008080', 'PETG']]);
		expect(far?.relaxed).toBe(true);
		expect(far!.de).toBeGreaterThan(MAX_STANDARD_DE);
		expect(only([['A', 'Silk Red', '#d31f26', 'PETG']])).toBeNull();
	});
});

describe('palettes against the real catalog', () => {
	const sweepBases = [
		'#ff0000',
		'#ffd400',
		'#00a86b',
		'#1f4fd8',
		'#8a2be2',
		'#ff69b4',
		'#222222',
		'#f5f5f5'
	];
	const brands = ['', 'Overture', 'Polymaker'];

	it('has candidates in both families', () => {
		expect(real.petg.length).toBeGreaterThan(100);
		expect(real.tpu.length).toBeGreaterThan(10);
	});
	it('no pre-made palette gets an excluded filament, and the named bad picks are gone', () => {
		for (const brand of brands)
			for (const p of PALETTES) {
				const r = resolvePalette(p.targets, real, { brand });
				for (const slot of SLOTS) {
					const m = r[slot];
					expect(m, `${p.id}/${slot}`).toBeTruthy();
					const t: SwatchTuple = [m!.brand, m!.colorName, m!.hex, m!.material];
					const src = (slot === 'primary' || slot === 'accent' ? real.petg : real.tpu).find(
						(x) => x[0] === t[0] && x[1] === t[1] && x[3] === t[3]
					)!;
					// Allowed outright, or (relaxed) matte only.
					const ok = isAllowedFilament(src) || (m!.relaxed && isAllowedFilament(src, true));
					expect(ok, `${p.id}/${slot}: ${label(m!)}`).toBe(true);
					if (slot === 'tire' || slot === 'soft') expect(materialFamily(m!.material)).toBe('tpu');
				}
				const names = Object.values(r).map((m) => m.name);
				expect(names).not.toContain('Sunlu Transparent Orange');
				expect(names).not.toContain('Sunlu Silk Black');
				expect(names).not.toContain('Polymaker PolyFlex TPU90 Grey');
			}
	}, 30_000);
	it('tires and soft are 95A or unspecified-hardness TPU', () => {
		for (const p of PALETTES) {
			const r = resolvePalette(p.targets, real);
			for (const slot of ['soft', 'tire'] as const) {
				const m = r[slot]!;
				expect(`${m.colorName} ${m.material}`).not.toMatch(/(?<![\d.])(?!95)\d{2,3}\s?-?[ad]\b/i);
				expect(m.material).toMatch(/^tpu/i);
				expect(ALLOWED_TPU_HARDNESS).toBe('95A');
			}
		}
	});
	it('generator sweep (base colors x harmonies x shuffles) yields only allowed filaments', () => {
		for (const b of sweepBases)
			for (const h of HARMONIES)
				for (let s = 0; s < 3; s++) {
					const r = resolvePalette(generateTargets(b, h.id, s), real, { brand: 'Overture' });
					for (const slot of SLOTS) {
						const m = r[slot];
						if (!m) continue;
						const items = slot === 'primary' || slot === 'accent' ? real.petg : real.tpu;
						const src = items.find(
							(x) => x[0] === m.brand && x[1] === m.colorName && x[3] === m.material
						)!;
						const ok = isAllowedFilament(src) || (m.relaxed && isAllowedFilament(src, true));
						expect(ok, `${b}/${h.id}/${s}/${slot}: ${label(m)}`).toBe(true);
						if (!m.relaxed) expect(isAllowedFilament(src)).toBe(true);
					}
				}
	}, 30_000);
	it('matching is deterministic', () => {
		for (const p of PALETTES)
			expect(resolvePalette(p.targets, real, { brand: 'Overture' })).toEqual(
				resolvePalette(p.targets, real, { brand: 'Overture' })
			);
	}, 30_000);
});
