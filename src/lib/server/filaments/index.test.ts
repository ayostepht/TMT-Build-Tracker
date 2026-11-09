import { describe, expect, it } from 'vitest';
import { brands, colors, flagsOf, materials, search, swatches } from './index.ts';
import { normalise } from '../../../../scripts/update-filaments.mjs';
import { materialFamily, preferMaterials, suggestName } from '#lib/filament-catalog.ts';

describe('catalog', () => {
	it('cascades brand -> material -> colors', () => {
		const b = brands().find((x) => x.materials.includes('PLA'));
		expect(b).toBeTruthy();
		expect(materials(b!.name)).toEqual(b!.materials);
		const cs = colors(b!.name, 'PLA');
		expect(cs.length).toBeGreaterThan(0);
		expect(cs[0].hex).toMatch(/^#[0-9a-f]{6}$/);
		expect(colors('nope', 'PLA')).toEqual([]);
		expect(materials('nope')).toEqual([]);
	});
	it('is case-insensitive on lookup and has no duplicate colors', () => {
		const b = brands()[0];
		expect(materials(b.name.toUpperCase())).toEqual(b.materials);
		const names = colors(b.name, b.materials[0]).map((c) => c.name.toLowerCase());
		expect(new Set(names).size).toBe(names.length);
	});
	it('searches by words across brand, material and color, max 50', () => {
		const hits = search('pla blue');
		expect(hits.length).toBeGreaterThan(0);
		expect(hits.length).toBeLessThanOrEqual(50);
		for (const h of hits)
			expect(`${h.brand} ${h.material} ${h.color.name}`.toLowerCase()).toMatch(/pla/);
		expect(search('')).toEqual([]);
		expect(search('zzzzqqqq')).toEqual([]);
	});
});

describe('helpers', () => {
	it('suggests names', () => {
		expect(suggestName('Overture', 'Digital Blue')).toBe('Overture Digital Blue');
		expect(suggestName('Overture', 'overture Red')).toBe('overture Red');
	});
	it('prefers TPU or PETG families without hiding others', () => {
		const m = ['ABS', 'PETG', 'TPU-95A', 'PLA'];
		expect(materialFamily('TPU 95A')).toBe('tpu');
		expect(preferMaterials(m, 'TPU 95A', (x) => x)).toEqual(['TPU-95A', 'ABS', 'PETG', 'PLA']);
		expect(preferMaterials(m, 'PETG', (x) => x)).toEqual(['PETG', 'ABS', 'TPU-95A', 'PLA']);
		expect(preferMaterials(m, undefined, (x) => x)).toEqual(m);
	});
});

describe('normalise', () => {
	const row = (o: Record<string, unknown>) => ({
		manufacturer: 'Acme',
		material: 'PLA',
		name: 'Red',
		diameter: 1.75,
		weight: 1000,
		color_hex: 'FF0000',
		color_hexes: null,
		finish: null,
		translucent: false,
		glow: false,
		...o
	});
	it('keeps 1.75 mm, dedupes, sorts, handles multicolor and flags', () => {
		const out = normalise(
			[
				row({}),
				row({ weight: 750 }),
				row({ name: 'Red', diameter: 2.85 }),
				row({ name: 'Aqua', color_hex: '00ffff', glow: true, finish: 'matte', weight: 500 }),
				row({ name: 'Rainbow', color_hex: null, color_hexes: ['112233', 'AABBCC'] }),
				row({ manufacturer: 'Abc', material: 'TPU', name: 'Clear', translucent: true }),
				row({ name: 'NoColor', color_hex: null })
			],
			{ fetchedAt: 'x' }
		);
		expect(out.brands.map((b) => b.name)).toEqual(['Abc', 'Acme']);
		const cols = out.brands[1].materials[0].colors;
		expect(cols.map((c) => c.name)).toEqual(['Aqua', 'Rainbow', 'Red']);
		expect(cols[0]).toEqual({
			name: 'Aqua',
			hex: '#00ffff',
			finish: 'matte',
			glow: true,
			weightG: 500
		});
		expect(cols[1]).toEqual({ name: 'Rainbow', hex: '#112233', hexes: ['#112233', '#aabbcc'] });
		expect(cols[2]).toEqual({ name: 'Red', hex: '#ff0000' });
		expect(out.brands[0].materials[0].colors[0].translucent).toBe(true);
		expect(out.fetchedAt).toBe('x');
	});
	it('tolerates garbage input', () => {
		expect(normalise(null).brands).toEqual([]);
		expect(normalise([null, {}]).brands).toEqual([]);
	});
});

describe('swatches', () => {
	it('lists compact tuples per material family', () => {
		const petg = swatches('petg');
		const tpu = swatches('tpu');
		expect(petg.length).toBeGreaterThan(500);
		expect(tpu.length).toBeGreaterThan(100);
		for (const [brand, name, hex, material] of [...petg.slice(0, 50), ...tpu.slice(0, 50)]) {
			expect(brand && name && material).toBeTruthy();
			expect(hex).toMatch(/^#[0-9a-f]{6}$/);
		}
		expect(petg.every((t) => materialFamily(t[3]) === 'petg')).toBe(true);
		expect(tpu.every((t) => materialFamily(t[3]) === 'tpu')).toBe(true);
	});
});

describe('swatch flags', () => {
	const find = (family: 'petg' | 'tpu', brand: string, name: string) =>
		swatches(family).find((t) => t[0] === brand && t[1] === name);
	it('emits a 5th flag element only for marked colors', () => {
		expect(find('petg', 'Matter3D Inc', 'Matte Gunmetal Grey')?.[4]).toBe('matte');
		expect(find('petg', '3DJAKE', 'Blue Transparent')?.[4]).toBe('translucent');
		expect(find('petg', 'CC3D', 'Glow in the Dark Green')?.[4]).toContain('glow');
		expect(find('petg', 'Ambrosia', 'Rainbow Fusion')?.[4]).toContain('multi');
		const plain = swatches('petg').filter((t) => t.length === 4);
		expect(plain.length).toBeGreaterThan(swatches('petg').length / 2);
		for (const t of swatches('petg').concat(swatches('tpu'))) {
			expect(t.length === 4 || t.length === 5).toBe(true);
			if (t.length === 5)
				expect(t[4]).toMatch(
					/^(matte|silk|translucent|glow|multi|approx)( (matte|silk|translucent|glow|multi|approx))*$/
				);
		}
	});
	it('maps each structured field, including silk, to a flag', () => {
		const c = { name: 'x', hex: '#000000' };
		expect(flagsOf(c)).toBe('');
		expect(flagsOf({ ...c, finish: 'glossy' })).toBe('');
		expect(flagsOf({ ...c, finish: 'silk' })).toBe('silk');
		expect(
			flagsOf({
				...c,
				finish: 'matte',
				glow: true,
				translucent: true,
				hexes: ['#000000', '#ffffff']
			})
		).toBe('matte translucent glow multi');
		expect(flagsOf({ ...c, hexes: ['#000000'] })).toBe('');
	});
});

describe('approximate hexes', () => {
	it('flags colors whose hex was sampled from a product photo', () => {
		const c = { name: 'X', hex: '#123456' };
		expect(flagsOf({ ...c, hexSource: 'image' })).toBe('approx');
		expect(flagsOf({ ...c, hexSource: 'store' })).toBe('');
		expect(flagsOf({ ...c, finish: 'matte', hexSource: 'image' })).toBe('matte approx');
	});
	it('the bundled Schoolhouse Spools swatches carry it', () => {
		const sh = swatches('petg').filter((t) => t[0] === 'Schoolhouse Spools');
		expect(sh.length).toBeGreaterThan(10);
		expect(sh.every((t) => (t[4] ?? '').split(' ').includes('approx'))).toBe(true);
	});
});
