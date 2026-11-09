import { afterEach, describe, expect, it } from 'vitest';
import {
	loadPreferredBrands,
	loadRecent,
	rememberRecent,
	savePreferredBrands
} from './swatches.ts';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	}
});
const KEY = 'tmt.recentFilaments.v1';

describe('loadRecent', () => {
	afterEach(() => store.clear());
	it('accepts 4- and 5-element tuples and drops malformed ones', () => {
		store.set(
			KEY,
			JSON.stringify([
				['A', 'Red', '#ff0000', 'PETG'],
				['B', 'Blue', '#0000ff', 'PETG', 'matte'],
				['C', 'Short', '#000000'],
				['D', 'Six', '#000000', 'PETG', 'x', 'y'],
				['E', 'Num', '#000000', 'PETG', 5]
			])
		);
		expect(loadRecent().map((t) => t[0])).toEqual(['A', 'B']);
	});
	it('returns [] for junk and keeps flags through rememberRecent', () => {
		store.set(KEY, '{nope');
		expect(loadRecent()).toEqual([]);
		rememberRecent(['B', 'Blue', '#0000ff', 'PETG', 'matte']);
		expect(loadRecent()).toEqual([['B', 'Blue', '#0000ff', 'PETG', 'matte']]);
	});
});

describe('preferred brands', () => {
	afterEach(() => store.clear());
	it('round-trips a list', () => {
		savePreferredBrands(['Sunlu', 'Overture', 'sunlu', ' ']);
		expect(loadPreferredBrands()).toEqual(['Sunlu', 'Overture']);
		savePreferredBrands([]);
		expect(loadPreferredBrands()).toEqual([]);
	});
	it('migrates the old single brand transparently', () => {
		store.set('tmt.preferredBrand.v1', 'Polymaker');
		expect(loadPreferredBrands()).toEqual(['Polymaker']);
		expect(store.has('tmt.preferredBrand.v1')).toBe(false);
		expect(JSON.parse(store.get('tmt.preferredBrands.v2')!)).toEqual(['Polymaker']);
		expect(loadPreferredBrands()).toEqual(['Polymaker']);
	});
	it('the new value wins over a stale old one, and an empty old value means none', () => {
		store.set('tmt.preferredBrands.v2', JSON.stringify(['Sunlu']));
		store.set('tmt.preferredBrand.v1', 'Polymaker');
		expect(loadPreferredBrands()).toEqual(['Sunlu']);
		store.clear();
		store.set('tmt.preferredBrand.v1', '');
		expect(loadPreferredBrands()).toEqual([]);
	});
	it('junk is ignored', () => {
		store.set('tmt.preferredBrands.v2', '{nope');
		expect(loadPreferredBrands()).toEqual([]);
		store.set('tmt.preferredBrands.v2', JSON.stringify(['A', 5, null]));
		expect(loadPreferredBrands()).toEqual(['A']);
	});
});
