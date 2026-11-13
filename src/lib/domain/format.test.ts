import { describe, expect, it } from 'vitest';
import { parseSlicerTime, sanePrintSeconds } from './format.ts';

describe('parseSlicerTime', () => {
	it('reads the ways people type a slicer time', () => {
		const t = 14 * 3600 + 20 * 60;
		for (const s of ['14h20m', '14h 20m', '14h 20', '14h20', '14:20', ' 14H 20M ', '14 hours 20'])
			expect(parseSlicerTime(s), s).toBe(t);
		expect(parseSlicerTime('14.3')).toBe(51480);
		expect(parseSlicerTime('14')).toBe(14 * 3600);
		expect(parseSlicerTime('90m')).toBe(5400);
		expect(parseSlicerTime('1d 2h')).toBe(26 * 3600);
	});
	it('rejects empty, zero and nonsense', () => {
		for (const s of ['', '  ', 'abc', '0', '0h 0m', '-3']) expect(parseSlicerTime(s), s).toBeNull();
	});
});

describe('sanePrintSeconds', () => {
	it('sums sane values', () => {
		expect(sanePrintSeconds(2760, 4440)).toBe(7200);
		expect(sanePrintSeconds(0, 60.4)).toBe(60);
	});
	it('rejects negative, non-finite, non-number, zero and over 30 days', () => {
		expect(sanePrintSeconds(-5e9, 5e9 + 3600)).toBeNull();
		expect(sanePrintSeconds(-1, 100)).toBeNull();
		expect(sanePrintSeconds(100, -1)).toBeNull();
		expect(sanePrintSeconds(NaN, 10)).toBeNull();
		expect(sanePrintSeconds(Infinity, 10)).toBeNull();
		expect(sanePrintSeconds('5', 10)).toBeNull();
		expect(sanePrintSeconds(undefined, 10)).toBeNull();
		expect(sanePrintSeconds(0, 0)).toBeNull();
		expect(sanePrintSeconds(2_592_000, 0)).toBe(2_592_000);
		expect(sanePrintSeconds(2_592_000, 1)).toBeNull();
	});
});
