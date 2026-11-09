import { describe, expect, it } from 'vitest';
import { swatches } from '../server/filaments/index.ts';
import type { SwatchTuple } from './palettes.ts';
import { chipBrandList, collapseDuplicates, pickerSwatches } from './swatch-picker.ts';

const names = (r: { neutrals: { t: SwatchTuple }[]; colorful: { t: SwatchTuple }[] }) =>
	[...r.neutrals, ...r.colorful].map((e) => `${e.t[0]} ${e.t[1]}`);

const tpu: SwatchTuple[] = [
	['GST3D', 'Blue 93A', '#1e5fd0', 'TPU'],
	['Overture', 'Blue', '#1e60d2', 'TPU-95A'],
	['Overture', 'Silk Gold', '#d4af37', 'TPU-95A'],
	['Sunlu', 'Black', '#101010', 'TPU']
];

describe('pickerSwatches', () => {
	it('hides 93A TPU and silk by default and counts them', () => {
		const r = pickerSwatches(tpu);
		expect(names(r)).toEqual(expect.arrayContaining(['Overture Blue', 'Sunlu Black']));
		expect(names(r)).not.toContain('GST3D Blue 93A');
		expect(names(r)).not.toContain('Overture Silk Gold');
		expect(r.hidden).toBe(2);
	});
	it('shows them, with a reason, when asked', () => {
		const r = pickerSwatches(tpu, { showAll: true });
		const all = [...r.neutrals, ...r.colorful];
		expect(all).toHaveLength(4);
		expect(all.find((e) => e.t[1] === 'Blue 93A')!.reason).toMatch(/95A/);
		expect(all.find((e) => e.t[1] === 'Silk Gold')!.reason).toMatch(/silk/);
		expect(all.find((e) => e.t[1] === 'Blue')!.reason).toBe('');
		expect(r.hidden).toBe(0);
	});
	it('a search also reaches excluded types', () => {
		expect(names(pickerSwatches(tpu, { query: 'silk' }))).toEqual(['Overture Silk Gold']);
		expect(names(pickerSwatches(tpu, { query: '#1e5fd0' }))).toEqual(['GST3D Blue 93A']);
	});
	it('filters by several brands', () => {
		const r = pickerSwatches(tpu, { brands: ['sunlu', 'GST3D'], showAll: true });
		expect(names(r).sort()).toEqual(['GST3D Blue 93A', 'Sunlu Black']);
	});
	it('on the real catalog, no excluded TPU or PETG is listed by default', () => {
		for (const fam of ['tpu', 'petg'] as const) {
			const r = pickerSwatches(swatches(fam));
			for (const e of [...r.neutrals, ...r.colorful]) expect(e.reason).toBe('');
			expect(r.hidden).toBeGreaterThan(0);
			expect(names(r).some((n) => /93A|[Ss]ilk/.test(n))).toBe(false);
		}
	});
});

describe('duplicates and ordering', () => {
	it('collapses same-brand same-hex and ΔE < 1, keeps other brands', () => {
		const items: SwatchTuple[] = [
			['A', 'Black', '#111111', 'PETG'],
			['A', 'Jet Black', '#111111', 'PETG'],
			['A', 'Near Black', '#121212', 'PETG'],
			['A', 'Grey', '#808080', 'PETG'],
			['B', 'Black', '#111111', 'PETG']
		];
		const out = collapseDuplicates(items.map((t) => ({ t, reason: '' })));
		expect(out.map((e) => `${e.t[0]} ${e.t[1]}`)).toEqual(['A Black', 'A Grey', 'B Black']);
	});
	it('a duplicate collapses onto the allowed entry', () => {
		const items: SwatchTuple[] = [
			['A', 'Silk Red', '#c00000', 'PETG'],
			['A', 'Red', '#c00000', 'PETG']
		];
		expect(names(pickerSwatches(items, { showAll: true }))).toEqual(['A Red']);
	});
	it('neutrals group by lightness with preferred brands first', () => {
		const items: SwatchTuple[] = [
			['Zed', 'Black', '#101010', 'PETG'],
			['Sunlu', 'Black', '#111111', 'PETG'],
			['Zed', 'White', '#f5f5f5', 'PETG'],
			['Sunlu', 'White', '#f4f4f4', 'PETG'],
			['Mid', 'Grey', '#808080', 'PETG']
		];
		expect(names(pickerSwatches(items, { preferred: ['Zed'] }))).toEqual([
			'Zed White',
			'Sunlu White',
			'Mid Grey',
			'Zed Black',
			'Sunlu Black'
		]);
	});
	it('colorful swatches of preferred brands come first', () => {
		const items: SwatchTuple[] = [
			['A', 'Red', '#d32f2f', 'PETG'],
			['B', 'Blue', '#1e88e5', 'PETG'],
			['C', 'Green', '#2e7d32', 'PETG']
		];
		const r = pickerSwatches(items, { preferred: ['C', 'B'] });
		expect(
			r.colorful
				.slice(0, 2)
				.map((e) => e.t[0])
				.sort()
		).toEqual(['B', 'C']);
		expect(r.colorful[2].t[0]).toBe('A');
	});
});

describe('chipBrandList', () => {
	it('puts preferred then selected first and always keeps selected', () => {
		const available = ['Overture', 'Sunlu', 'Jayo', 'Zzz', 'eSUN'];
		const out = chipBrandList({
			available,
			preferred: ['sunlu'],
			selected: ['Zzz'],
			recent: ['Jayo'],
			max: 3
		});
		expect(out).toEqual(['Sunlu', 'Zzz', 'Jayo']);
		expect(
			chipBrandList({ available, preferred: [], selected: ['Zzz'], recent: [], max: 1 })
		).toEqual(['Zzz']);
	});
});
