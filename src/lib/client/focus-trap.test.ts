import { describe, expect, it } from 'vitest';
import { isTopTrap, wrapTarget } from './focus-trap.ts';

describe('wrapTarget', () => {
	it('wraps forward from the last and backward from the first', () => {
		expect(wrapTarget(3, 2, false)).toBe(0);
		expect(wrapTarget(3, 0, true)).toBe(2);
	});
	it('leaves moves inside the list to the browser', () => {
		expect(wrapTarget(3, 1, false)).toBeNull();
		expect(wrapTarget(3, 1, true)).toBeNull();
	});
	it('pulls focus in when it is outside the list', () => {
		expect(wrapTarget(3, -1, false)).toBe(0);
		expect(wrapTarget(3, -1, true)).toBe(2);
	});
	it('does nothing for an empty list', () => {
		expect(wrapTarget(0, -1, false)).toBeNull();
	});
	it('a single element wraps onto itself', () => {
		expect(wrapTarget(1, 0, false)).toBe(0);
		expect(wrapTarget(1, 0, true)).toBe(0);
	});
});

describe('isTopTrap', () => {
	it('is true with no trap registered', () => {
		expect(isTopTrap(undefined)).toBe(true);
	});
});
