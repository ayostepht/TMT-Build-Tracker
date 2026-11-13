import { describe, expect, it } from 'vitest';
import { applyRun, recomputeParts, startPrinting } from './index.ts';
import { applyPatches, makeView, run } from './fixtures.ts';

const now = new Date('2026-11-12T18:23:00Z');
const T = '2026-11-12T17:37:00.000Z';

function printingView() {
	return applyPatches(makeView(), [
		{ slug: 'tires', status: 'Printing', startedAt: T, runEstSeconds: 7200 }
	]);
}
const live = new Set(['tires']);

describe('runs on a plate that is printing again on a live job', () => {
	it('a Failed plate run leaves live parts untouched', () => {
		const v = printingView();
		const r = run({ plateNumber: 23, result: 'Failed' });
		expect(applyRun(v, r, now, { livePrinting: live })).toEqual([]);
	});
	it('Partial too; without the set it is Reprint as before', () => {
		const v = printingView();
		expect(
			applyRun(v, run({ plateNumber: 23, result: 'Partial' }), now, { livePrinting: live })
		).toEqual([]);
		const out = applyRun(v, run({ plateNumber: 23, result: 'Failed' }), now);
		expect(out.find((p) => p.slug === 'tires')).toMatchObject({
			status: 'Reprint',
			startedAt: null,
			runEstSeconds: null
		});
	});
	it('a part log Failed leaves a live part alone', () => {
		const v = printingView();
		expect(
			applyRun(v, run({ partSlug: 'tires', result: 'Failed' }), now, { livePrinting: live })
		).toEqual([]);
	});
	it('a live slug that is not Printing is still flagged for Reprint', () => {
		const v = makeView();
		const out = applyRun(v, run({ plateNumber: 23, result: 'Failed' }), now, {
			livePrinting: live
		});
		expect(out.find((p) => p.slug === 'tires')?.status).toBe('Reprint');
	});
	it('recomputeParts keeps Printing for a live slug, drops it otherwise', () => {
		const f = run({ plateNumber: 23, result: 'Failed' });
		const v = { ...printingView(), runs: [f] };
		expect(recomputeParts(v, [f], ['tires'], { livePrinting: live })).toEqual([]);
		expect(recomputeParts(v, [], ['tires'], { livePrinting: live })).toEqual([]);
		expect(recomputeParts(v, [f], ['tires'])[0]).toMatchObject({ status: 'Reprint' });
	});
});

describe('startPrinting with a live job', () => {
	it('takes the job start and estimate instead of now', () => {
		const v = makeView();
		const out = startPrinting(v, ['tires'], now, {
			startedAt: new Date(T),
			runEstSeconds: 5400
		});
		expect(out).toEqual([{ slug: 'tires', status: 'Printing', startedAt: T, runEstSeconds: 5400 }]);
	});
	it('no live job: now', () => {
		expect(startPrinting(makeView(), ['tires'], now)).toEqual([
			{ slug: 'tires', status: 'Printing', startedAt: now.toISOString() }
		]);
	});
});
