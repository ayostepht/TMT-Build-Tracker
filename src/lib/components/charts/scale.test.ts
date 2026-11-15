import { describe, expect, it } from 'vitest';
import {
	formatValue,
	labelStep,
	linearScale,
	niceCeil,
	niceTicks,
	rovingIndex,
	truncate
} from './scale.ts';

describe('niceCeil', () => {
	it('rounds up to 1, 2, 2.5, 5, 10 times a power of ten', () => {
		expect(niceCeil(0.7)).toBe(1);
		expect(niceCeil(1.2)).toBe(2);
		expect(niceCeil(2.3)).toBe(2.5);
		expect(niceCeil(3)).toBe(5);
		expect(niceCeil(7)).toBe(10);
		expect(niceCeil(42)).toBe(50);
		expect(niceCeil(120)).toBe(200);
		expect(niceCeil(0.034)).toBe(0.05);
	});
	it('falls back to 1 for no data', () => {
		expect(niceCeil(0)).toBe(1);
		expect(niceCeil(-3)).toBe(1);
		expect(niceCeil(NaN)).toBe(1);
	});
});

describe('niceTicks', () => {
	it('starts at 0, ends at the nice max, and covers the data', () => {
		for (const max of [0.3, 1, 7, 13, 48, 99, 130, 1234]) {
			const { ticks, max: top } = niceTicks(max);
			expect(ticks[0]).toBe(0);
			expect(top).toBeGreaterThanOrEqual(max);
			expect(ticks.at(-1)).toBe(top);
			expect(ticks.length).toBeGreaterThanOrEqual(2);
			expect(ticks.length).toBeLessThanOrEqual(7);
		}
	});
	it('is evenly spaced with no float noise', () => {
		expect(niceTicks(30).ticks).toEqual([0, 10, 20, 30]);
		expect(niceTicks(48).ticks).toEqual([0, 20, 40, 60]);
		const { ticks } = niceTicks(0.6);
		const steps = ticks.slice(1).map((t, i) => Math.round((t - ticks[i]) * 1e6));
		expect(new Set(steps).size).toBe(1);
		expect(ticks.every((t) => t === Number(t.toFixed(4)))).toBe(true);
	});
	it('gives an axis for empty data', () => {
		expect(niceTicks(0).max).toBe(1);
		expect(niceTicks(0).ticks[0]).toBe(0);
	});
});

describe('linearScale', () => {
	it('maps and inverts', () => {
		const y = linearScale([0, 10], [100, 0]);
		expect(y(0)).toBe(100);
		expect(y(10)).toBe(0);
		expect(y(2.5)).toBe(75);
	});
	it('a zero-width domain maps to the range start', () => {
		expect(linearScale([5, 5], [10, 20])(5)).toBe(10);
	});
});

describe('labels and keys', () => {
	it('formats numbers with trimmed decimals', () => {
		expect(formatValue(12)).toBe('12');
		expect(formatValue(12.34)).toBe('12.3');
		expect(formatValue(1234.5)).toBe('1,234.5');
		expect(formatValue(0.04, 2)).toBe('0.04');
	});
	it('thins labels to fit', () => {
		expect(labelStep(60, 40)).toBe(1);
		expect(labelStep(20, 40)).toBe(2);
		expect(labelStep(10, 45)).toBe(5);
	});
	it('truncates with an ellipsis', () => {
		expect(truncate('Short', 10)).toBe('Short');
		expect(truncate('A very long filament name', 10)).toBe('A very lo…');
	});
	it('roving index clamps and ignores other keys', () => {
		expect(rovingIndex('ArrowRight', 2, 3)).toBe(2);
		expect(rovingIndex('ArrowLeft', 0, 3)).toBe(0);
		expect(rovingIndex('Home', 2, 5)).toBe(0);
		expect(rovingIndex('End', 0, 5)).toBe(4);
		expect(rovingIndex('a', 0, 5)).toBeNull();
		expect(rovingIndex('ArrowRight', 0, 0)).toBeNull();
	});
});
