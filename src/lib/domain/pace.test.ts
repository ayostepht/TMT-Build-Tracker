import { describe, expect, it } from 'vitest';
import { paceOf, plateTimeBadge, paceText, timeStats } from './index.ts';
import { makeView, run } from './fixtures.ts';
import type { BuildView, PrintRun } from './types.ts';

function withRuns(over: Partial<PrintRun>[]): BuildView {
	const v = makeView();
	return { ...v, runs: over.map((o) => run({ plateNumber: 1, ...o })) };
}
const est1 = (v: BuildView) => (v.plates.find((p) => p.number === 1)!.estSeconds ?? 0) / 3600;

describe('pace with a manual plate time', () => {
	const plateWith = (over: Record<string, unknown>) => {
		const v = makeView();
		return { v, pl: { ...v.plates[0], runs: 1, perPartRuns: false, ...over } };
	};
	it('compares a run to the manual time, not the file time', () => {
		const { v, pl } = plateWith({
			estSeconds: 51480, // 14.3 h typed
			estSource: 'manual',
			baseEstSeconds: 117720, // 32.7 h in the file
			baseEstSource: 'slicer'
		});
		const view: BuildView = {
			...v,
			plates: [pl, ...v.plates.slice(1)],
			runs: [run({ plateNumber: 1, hours: 14 })]
		};
		const p = paceOf(view)!;
		expect(p.ratio).toBeCloseTo(14 / 14.3, 3);
		expect(p.ratio).toBeGreaterThan(0.95);
		expect(p.basis).toBe('slicer');
	});
	it('a 13.6 h run on a 13.65 h manual time is on pace', () => {
		const { v, pl } = plateWith({ estSeconds: 49140, estSource: 'manual' });
		const p = paceOf({
			...v,
			plates: [pl, ...v.plates.slice(1)],
			runs: [run({ plateNumber: 1, hours: 13.6 })]
		});
		expect(p?.ratio).toBeCloseTo(13.6 / 13.65, 3);
	});
	it("compares a run to its own logged est_seconds before the plate's", () => {
		const { v, pl } = plateWith({ estSeconds: 117720, estSource: 'slicer' });
		const view: BuildView = {
			...v,
			plates: [pl, ...v.plates.slice(1)],
			runs: [run({ plateNumber: 1, hours: 13.6, estSeconds: 49140 })]
		};
		expect(paceOf(view)?.ratio).toBeCloseTo(13.6 / 13.65, 3);
		// without its own time the same run measures against the plate's 32.7 h
		expect(paceOf({ ...view, runs: [run({ plateNumber: 1, hours: 13.6 })] })?.ratio).toBeCloseTo(
			13.6 / 32.7,
			3
		);
	});
	it('labels the source', () => {
		const { pl } = plateWith({ estSeconds: 51480, estSource: 'manual' });
		expect(plateTimeBadge(pl, null)!.main).toBe('~14 h');
		expect(
			plateTimeBadge(pl, {
				ratio: 0.98,
				sampleHours: 14,
				estHours: 14.3,
				runs: 1,
				basis: 'slicer',
				text: ''
			})!.base
		).toBe('your entry 14 h');
	});
});

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
		// the rims: runs 2 x 2 parts = 4 prints; the time is one print
		const rims = plateTimeBadge(
			{ ...pl, runs: 2, perPartRuns: true, parts: ['rims-1-4', 'rims-2-3'] },
			null
		)!;
		expect(rims.main).toBe('~10 h per print');
		expect(rims.total).toBe('41 h total');
	});
});

describe('pace with a split Partial', () => {
	it('uses the scaled estSeconds of the printed half, not the whole plate time', () => {
		const v = makeView();
		const plate = v.plates.find((p) => !p.perPartRuns && p.runs === 1 && p.parts.length >= 2)!;
		const est = plate.estSeconds ?? 36000;
		const withEst = {
			...v,
			plates: v.plates.map((p) => (p.number === plate.number ? { ...p, estSeconds: est } : p))
		};
		// The printed half took half the plate time and was planned as half of it: on pace.
		const r = run({
			plateNumber: plate.number,
			partSlugs: [plate.parts[0]],
			result: 'Success',
			hours: Math.round((est / 3600 / 2) * 1.1 * 10) / 10 + 0.05,
			estSeconds: Math.round(est / 2)
		});
		const many = Array.from({ length: 6 }, (_, i) => ({ ...r, id: `s${i}` }));
		const p = paceOf({ ...withEst, runs: many })!;
		expect(p).not.toBeNull();
		expect(p.ratio).toBeGreaterThan(1.05);
		expect(p.ratio).toBeLessThan(1.2);
		// Without the scaled time a subset run is ignored, so there would be no pace at all.
		expect(paceOf({ ...withEst, runs: many.map((x) => ({ ...x, estSeconds: null })) })).toBeNull();
	});
});
