import { describe, expect, it } from 'vitest';
import { isObj } from './guards.ts';

describe('isObj', () => {
	it('accepts plain objects, class instances and null-prototype objects', () => {
		expect(isObj({})).toBe(true);
		expect(isObj({ a: 1 })).toBe(true);
		expect(isObj(new (class Foo {})())).toBe(true);
		expect(isObj(Object.create(null))).toBe(true);
	});
	it('rejects null, arrays and primitives', () => {
		expect(isObj(null)).toBe(false);
		expect(isObj(undefined)).toBe(false);
		expect(isObj([])).toBe(false);
		expect(isObj([1])).toBe(false);
		expect(isObj('x')).toBe(false);
		expect(isObj(1)).toBe(false);
		expect(isObj(true)).toBe(false);
		expect(isObj(() => 1)).toBe(false);
	});
});
