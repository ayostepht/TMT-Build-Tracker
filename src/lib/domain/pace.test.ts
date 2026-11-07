import { describe, expect, it } from 'vitest';
import { paceOf, plateTimeBadge, paceText, timeStats } from './index.ts';
import { makeView, run } from './fixtures.ts';
import type { BuildView, PrintRun } from './types.ts';

function withRuns(over: Partial<PrintRun>[]): BuildView {
	const v = makeView();
	return { ...v, runs: over.map((o) => run({ plateNumber: 1, ...o })) };
}
const est1 = (v: BuildView) => (v.plates.find((p) => p.number === 1)!.estSeconds ?? 0) / 3600;

describe('pace', () => {
	it('waits for 12 estimated hours of usable runs', () => {
		const v0 = makeView();
		const e = est1(v0);
		expect(paceOf(withRuns([{ hours: Math.round(e * 0.9 * 10) / 10 + 0.05 }]))).not.toBeNull();
		expect(paceOf(withRuns([]))).toBeNull();
		const small = withRuns([{ plateNumber: 21, hours: 3 }]);
		expect(paceOf(small)).toBeNull();
	});
	it('ignores failed, partial, subset, untimed and outlier runs', () => {
		const e = est1(makeView());
		const good = e * 0.93 + 0.03;
		const v = withRuns([
			{ hours: good },
			{ hours: good, result: 'Failed' },
			{ hours: good, result: 'Partial' },
			{ hours: null },
			{ hours: e * 0.2 }, // under 30%
			{ hours: e * 3.5 } // over 300%
		]);
		const p = paceOf(v)!;
		expect(p.runs).toBe(1);
		expect(p.ratio).toBeCloseTo(good / e);
	});
	it('ignores a time that is exactly the plate time (the sheet prefill)', () => {
		const e = est1(makeView());
		expect(paceOf(withRuns([{ hours: Math.round(e * 10) / 10 }]))).toBeNull();
	});
	it('weights by hours and agrees with timeStats', () => {
		const e = est1(makeView());
		const v = withRuns([{ hours: e * 0.9 + 0.03 }, { hours: e * 1.2 + 0.03 }]);
		const p = paceOf(v)!;
		expect(p.ratio).toBeCloseTo((e * 2.1 + 0.06) / (e * 2));
		expect(timeStats(v).paceRatio).toBe(p.ratio);
		expect(timeStats(v).pace?.text).toBe(p.text);
	});
	it('text', () => {
		expect(paceText(0.93)).toBe('you print 7% faster than the slicer');
		expect(paceText(1.1, 'estimate')).toBe('you print 10% slower than the estimates');
		expect(paceText(1.001)).toBe('you print right on the slicer');
	});
	it('plate badge: base time before a pace, adjusted time after', () => {
		const v = makeView();
		const pl = { ...v.plates[0], estSeconds: 36720, estSource: 'slicer' as const, runs: 1 };
		expect(plateTimeBadge({ ...pl, estSeconds: 0 }, null)).toBeNull();
		expect(plateTimeBadge(pl, null)!.main).toBe('~10 h');
		const pace = {
			ratio: 0.92,
			sampleHours: 20,
			estHours: 21,
			runs: 2,
			basis: 'slicer' as const,
			text: ''
		};
		const b = plateTimeBadge(pl, pace)!;
		expect(b.main).toBe('≈ 9.4 h at your pace');
		expect(b.base).toBe('slicer 10 h');
		const multi = plateTimeBadge({ ...pl, runs: 2, perPartRuns: false }, pace)!;
		expect(multi.main).toBe('≈ 9.4 h per run at your pace');
		expect(multi.total).toBe('19 h total');
	});
});
