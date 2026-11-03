import { describe, expect, it } from 'vitest';
import { brands, colors, materials, search } from './index.ts';
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
