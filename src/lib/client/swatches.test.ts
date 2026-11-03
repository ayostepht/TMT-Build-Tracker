import { afterEach, describe, expect, it } from 'vitest';
import { loadRecent, rememberRecent } from './swatches.ts';

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
