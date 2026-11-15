import { describe, expect, it } from 'vitest';
import { buildStarted, startedSummary } from './started.ts';
import { applyPatches, makeView, run } from './fixtures.ts';

const slugs = () => Object.keys(makeView().state);

describe('buildStarted', () => {
	it('a fresh build has not started', () => {
		const v = makeView();
		const s = buildStarted(v);
		expect(s).toMatchObject({
			started: false,
			runs: 0,
			printed: 0,
			notToPrint: 0,
			printingParts: 0,
			printingPlates: [],
			liveJobs: 0
		});
		expect(s.totalParts).toBe(slugs().length);
		expect(v.started.started).toBe(false);
		expect(startedSummary(s)).toBe('');
	});
	it('a logged run starts it', () => {
		const v = { ...makeView(), runs: [run({ plateNumber: 1 })] };
		expect(buildStarted(v)).toMatchObject({ started: true, runs: 1 });
	});
	it('a Reprint part counts', () => {
		const v = applyPatches(makeView(), [{ slug: slugs()[0], status: 'Reprint' }]);
		expect(v.started).toMatchObject({ started: true, notToPrint: 1, printed: 0 });
	});
	it('a Printing part counts and names its plate', () => {
		const base = makeView();
		const pl = base.plates[0];
		const v = applyPatches(base, [{ slug: pl.parts[0], status: 'Printing' }]);
		expect(v.started).toMatchObject({ started: true, printingParts: 1 });
		expect(v.started.printingPlates).toContain(pl.number);
	});
	it('a live job alone counts (slug set or full info)', () => {
		const v = makeView();
		const pl = v.plates[0];
		expect(buildStarted(v, new Set([pl.parts[0]]))).toMatchObject({
			started: true,
			liveJobs: 1,
			printingParts: 1
		});
		const s = buildStarted(v, { count: 1, slugs: [], plates: [7, 3, 7] });
		expect(s).toMatchObject({ started: true, liveJobs: 1, printingPlates: [3, 7] });
		expect(buildStarted(v, new Set()).started).toBe(false);
	});
	it('a draft is never started', () => {
		const v = makeView();
		const d = {
			...applyPatches(v, [{ slug: slugs()[0], status: 'Printed' }]),
			runs: [run({})],
			build: { ...v.build, kind: 'draft' as const }
		};
		expect(buildStarted(d, new Set(['x'])).started).toBe(false);
	});
});

describe('startedSummary', () => {
	it('reads as one sentence', () => {
		expect(
			startedSummary({
				started: true,
				runs: 18,
				printed: 22,
				notToPrint: 23,
				printingParts: 1,
				printingPlates: [4],
				liveJobs: 1,
				totalParts: 64
			})
		).toBe('Plate 4 is printing; 22 of 64 parts printed; 18 prints logged');
	});
	it('handles several plates, one run and progress without printed parts', () => {
		expect(
			startedSummary({
				started: true,
				runs: 1,
				printed: 0,
				notToPrint: 2,
				printingParts: 0,
				printingPlates: [],
				liveJobs: 0,
				totalParts: 10
			})
		).toBe('2 parts have progress; 1 print logged');
		expect(
			startedSummary({
				started: true,
				runs: 0,
				printed: 0,
				notToPrint: 2,
				printingParts: 2,
				printingPlates: [2, 5],
				liveJobs: 0,
				totalParts: 10
			})
		).toBe('Plates 2, 5 are printing');
	});
});
