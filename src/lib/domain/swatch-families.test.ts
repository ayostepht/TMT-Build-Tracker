import { describe, expect, it } from 'vitest';
import { colorFamily, type FamilyId } from './swatch-picker.ts';

const cases: Record<FamilyId, string[]> = {
	// pure red, crimson, a lipstick red, neon red-orange
	red: ['#ff0000', '#dc143c', '#d23d49', '#af4a4c', '#fe2a31', '#ff4d2b'],
	// coral, orange, neon and sunny oranges
	orange: ['#ff7f50', '#ff8c00', '#ff6600', '#fa8423', '#f65d33', '#ffa500'],
	// gold, yellow, mango
	yellow: ['#ffd700', '#d4af37', '#f2b706', '#e8bd00', '#ddaf27'],
	green: ['#2e9e4a', '#4caf50'],
	teal: ['#12a5a0', '#038a89'],
	blue: ['#1e60d2', '#0378d0'],
	purple: ['#7b3fc4'],
	pink: ['#e8509f', '#d99ca4'],
	// rust, copper, brown, tan, coffee, dark copper
	brown: ['#b7410e', '#8b3a1b', '#9d3707', '#6b4423', '#d2b48c', '#724e3d', '#7f4031', '#946037']
};

describe('colorFamily on real catalog colors', () => {
	for (const [family, hexes] of Object.entries(cases))
		it(`${family}`, () => {
			for (const hex of hexes) expect([hex, colorFamily(hex)]).toEqual([hex, family]);
		});
});
