import { describe, expect, it } from 'vitest';
import { swatches } from '../server/filaments/index.ts';
import type { SwatchTuple } from './palettes.ts';
import {
	chipBrandList,
	closestMatches,
	collapseDuplicates,
	colorFamily,
	groupByFamily,
	isApproxHex,
	pickerSwatches
} from './swatch-picker.ts';

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
		expect(all).toHaveLength(3);
		// The excluded 93A blue looks like Overture's blue, so it sits behind it.
		const blue = all.find((e) => e.t[1] === 'Blue')!;
		expect(blue.others!.map((o) => o.t[1])).toEqual(['Blue 93A']);
		expect(blue.others![0].reason).toMatch(/95A/);
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
			['Sunlu', 'Black', '#2a2a2a', 'PETG'],
			['Zed', 'White', '#f5f5f5', 'PETG'],
			['Sunlu', 'White', '#e6e6e6', 'PETG'],
			['Mid', 'Grey', '#808080', 'PETG']
		];
		expect(names(pickerSwatches(items, { preferred: ['Zed'] }))).toEqual([
			'Zed White',
			'Sunlu White',
			'Mid Grey',
			'Sunlu Black',
			'Zed Black'
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

describe('cross-brand merge', () => {
	const brands10 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
	const blacks = brands10.map((b, i): SwatchTuple => [
		b,
		'Black',
		i % 2 ? '#101010' : '#111112',
		'PETG'
	]);

	it('identical blacks from 10 brands become one swatch with 9 alternates', () => {
		const r = pickerSwatches(blacks);
		expect(r.neutrals).toHaveLength(1);
		expect(r.neutrals[0].others).toHaveLength(9);
	});
	it('the representative is preferred > popular > other, and allowed > excluded', () => {
		const items: SwatchTuple[] = [
			['Zeta', 'Red', '#d32f2f', 'PETG'],
			['Elegoo', 'Red', '#d22f2f', 'PETG'],
			['Sunlu', 'Red', '#d32f30', 'PETG']
		];
		expect(pickerSwatches(items).colorful.map((e) => e.t[0])).toEqual(['Elegoo']);
		expect(pickerSwatches(items, { preferred: ['sunlu'] }).colorful.map((e) => e.t[0])).toEqual([
			'Sunlu'
		]);
		const noPop: SwatchTuple[] = [
			['Zeta', 'Red', '#d32f2f', 'PETG'],
			['Yank', 'Red', '#d32f2f', 'PETG']
		];
		expect(pickerSwatches(noPop).colorful).toHaveLength(1);
		const mixed: SwatchTuple[] = [
			['Overture', 'Silk Red', '#d32f2f', 'PETG'],
			['Zeta', 'Red', '#d32f2f', 'PETG']
		];
		const r = pickerSwatches(mixed, { showAll: true, preferred: ['Overture'] });
		expect(r.colorful).toHaveLength(1);
		expect(r.colorful[0].t[0]).toBe('Zeta');
		expect(r.colorful[0].others![0].reason).toMatch(/silk/);
	});
	it('the representative of unranked brands is the one nearest the cluster centre', () => {
		const items: SwatchTuple[] = [
			['P', 'Grey', '#808080', 'PETG'],
			['Q', 'Grey', '#848484', 'PETG'],
			['R', 'Grey', '#888888', 'PETG']
		];
		const r = pickerSwatches(items);
		expect(r.neutrals).toHaveLength(1);
		expect(r.neutrals[0].t[0]).toBe('Q');
	});
	it('distinct shades stay separate', () => {
		const items: SwatchTuple[] = [
			['A', 'Black', '#000000', 'PETG'],
			['B', 'Dark grey', '#2a2a2a', 'PETG'],
			['C', 'Grey', '#808080', 'PETG'],
			['D', 'Red', '#d32f2f', 'PETG'],
			['E', 'Dark red', '#a02020', 'PETG']
		];
		const r = pickerSwatches(items);
		expect(r.neutrals).toHaveLength(3);
		expect(r.colorful).toHaveLength(2);
	});
	it('one selected brand: no cross-brand merge', () => {
		const items: SwatchTuple[] = [...blacks, ['A', 'Grey', '#808080', 'PETG']];
		const r = pickerSwatches(items, { brands: ['A'] });
		expect(r.neutrals).toHaveLength(2);
		expect(r.neutrals.every((e) => !e.others)).toBe(true);
		expect(pickerSwatches(items, { brands: ['A', 'B'] }).neutrals).toHaveLength(2);
	});
	it('a search is not merged', () => {
		const r = pickerSwatches(blacks, { query: 'black' });
		expect(r.neutrals).toHaveLength(10);
	});
	it('is quick on a few thousand swatches and memoizes', () => {
		const big: SwatchTuple[] = [];
		for (let i = 0; i < 2500; i++) {
			const v = (i * 2654435761) >>> 0;
			const hex = `#${(v & 0xffffff).toString(16).padStart(6, '0')}`;
			big.push([`Brand${i % 40}`, `C${i}`, hex, 'PETG']);
		}
		pickerSwatches(big, { showAll: true });
		const t0 = performance.now();
		const first = pickerSwatches(big, { showAll: false, preferred: ['x'] });
		expect(performance.now() - t0).toBeLessThan(250);
		expect(pickerSwatches(big, { showAll: false, preferred: ['x'] })).toBe(first);
	});
	it('real catalog: neutrals shrink a lot with all brands', () => {
		const items = swatches('tpu');
		const merged = pickerSwatches(items);
		const sep = pickerSwatches(items, { brands: [...new Set(items.map((i) => i[0]))].slice(0, 1) });
		expect(merged.neutrals.length).toBeLessThan(30);
		expect(sep.neutrals.every((e) => !e.others)).toBe(true);
	});
});

describe('picker layout helpers', () => {
	it('puts colors into hue families', () => {
		expect(colorFamily('#e53935')).toBe('red');
		expect(colorFamily('#ff8c00')).toBe('orange');
		expect(colorFamily('#f2d41c')).toBe('yellow');
		expect(colorFamily('#2e9e4a')).toBe('green');
		expect(colorFamily('#12a5a0')).toBe('teal');
		expect(colorFamily('#1e60d2')).toBe('blue');
		expect(colorFamily('#7b3fc4')).toBe('purple');
		expect(colorFamily('#e8509f')).toBe('pink');
		expect(colorFamily('#6b4423')).toBe('brown');
	});
	it('groups in family order and drops empty families', () => {
		const r = pickerSwatches(
			[
				['A', 'Blue', '#1e60d2', 'PETG'],
				['A', 'Red', '#e53935', 'PETG'],
				['A', 'Blue2', '#2a50c0', 'PETG']
			],
			{}
		);
		const g = groupByFamily(r.colorful);
		expect(g.map((x) => x.id)).toEqual(['red', 'blue']);
		expect(g[1].entries).toHaveLength(2);
	});
	it('lists the closest other colors first', () => {
		const r = pickerSwatches(
			[
				['A', 'Red', '#e53935', 'PETG'],
				['B', 'Near red', '#ee6a5a', 'PETG'],
				['C', 'Blue', '#1e60d2', 'PETG'],
				['D', 'Same', '#e53935', 'PETG']
			],
			{ brands: ['A', 'B', 'C'] }
		);
		const c = closestMatches(r.colorful, '#e53935', 2);
		expect(c.map((e) => e.t[1])).toEqual(['Near red', 'Blue']);
	});
	it('flags image-estimated hexes', () => {
		expect(isApproxHex(['Schoolhouse Spools', 'Schoolbus', '#f2b705', 'PETG', 'approx'])).toBe(
			true
		);
		expect(isApproxHex(['Overture', 'Red', '#e53935', 'PETG'])).toBe(false);
		expect(isApproxHex(['X', 'Y', '#e53935', 'PETG', 'matte approx'])).toBe(true);
	});
});
