import { describe, expect, it } from 'vitest';
import { applyRun, recomputeParts, runInfo } from './index.ts';
import { applyPatches, makeView, run } from './fixtures.ts';

const now = new Date(2026, 2, 5, 12, 0, 0);

/** Log runs the way the server does, one by one. */
function logAll(runs: ReturnType<typeof run>[]) {
	let v = makeView();
	for (const r of runs) {
		v = { ...applyPatches(v, applyRun(v, r, now)), runs: [...v.runs, r] };
	}
	return v;
}
const without = (v: ReturnType<typeof makeView>, id: string) => v.runs.filter((r) => r.id !== id);

describe('recomputeParts', () => {
	it('deleting the only Success puts a part-log part back to To print', () => {
		const r = run({ partSlug: 'footrest', date: '2026-03-01' });
		const v = logAll([r]);
		expect(v.state['footrest']).toMatchObject({ status: 'Printed', printedOn: '2026-03-01' });
		const out = recomputeParts(v, without(v, r.id), ['footrest']);
		expect(out).toEqual([{ slug: 'footrest', status: 'To print', printedOn: null }]);
		expect(applyPatches(v, out).state['footrest'].printedOn).toBeNull();
	});

	it('deleting one of two wins on a perPartRuns plate goes back to not printed (1 of 2)', () => {
		const a = run({ plateNumber: 13, partSlug: 'rims-1-4', date: '2026-03-01' });
		const b = run({ plateNumber: 13, partSlug: 'rims-1-4', date: '2026-03-02' });
		const v = logAll([a, b]);
		expect(v.state['rims-1-4'].status).toBe('Printed');
		expect(v.state['rims-2-3'].status).toBe('To print');
		const rest = without(v, b.id);
		const out = recomputeParts(v, rest, ['rims-1-4']);
		expect(out[0]).toMatchObject({ slug: 'rims-1-4', status: 'To print', printedOn: null });
		expect(runInfo({ ...v, runs: rest }, 13, 'rims-1-4')).toEqual({ run: 2, of: 2 });
		// the other win remains: 1 of 2 done
		const out2 = recomputeParts(v, without(v, a.id), ['rims-1-4']);
		expect(out2[0].status).toBe('To print');
	});

	it('keeps Printing when still Printing with a partial win', () => {
		const a = run({ plateNumber: 23, date: '2026-03-01' });
		const b = run({ plateNumber: 23, date: '2026-03-02' });
		let v = logAll([a, b]);
		v = applyPatches(v, [{ slug: 'tires', status: 'Printing', startedAt: '2026-03-03T00:00:00Z' }]);
		const out = recomputeParts(v, without(v, b.id), ['tires']);
		expect(out).toEqual([{ slug: 'tires', printedOn: null }]);
	});

	it('Success changed to Failed gives Reprint', () => {
		const r = run({ partSlug: 'footrest' });
		const v = logAll([r]);
		const edited = [{ ...r, result: 'Failed' as const }];
		const out = recomputeParts(v, edited, ['footrest']);
		expect(out[0]).toMatchObject({ slug: 'footrest', status: 'Reprint', printedOn: null });
	});

	it('Failed changed to Success prints with the run date and ticks components', () => {
		const r = run({ plateNumber: 24, result: 'Failed', date: '2026-02-01' });
		const v = logAll([r]);
		expect(v.state['footrest'].status).toBe('Reprint');
		const out = recomputeParts(v, [{ ...r, result: 'Success' }], ['footrest']);
		expect(out[0]).toMatchObject({ status: 'Printed', printedOn: '2026-02-01' });
	});

	it('changing the date moves printedOn', () => {
		const r = run({ partSlug: 'footrest', date: '2026-03-01' });
		const v = logAll([r]);
		const out = recomputeParts(v, [{ ...r, date: '2026-03-04' }], ['footrest']);
		expect(out).toEqual([{ slug: 'footrest', printedOn: '2026-03-04' }]);
	});

	it('only touches the slugs it is given', () => {
		const r = run({ partSlug: 'footrest' });
		const other = run({ partSlug: 'headrest-mount' });
		const v = logAll([r, other]);
		const out = recomputeParts(v, without(v, r.id), ['footrest']);
		expect(out.map((p) => p.slug)).toEqual(['footrest']);
		expect(recomputeParts(v, without(v, r.id), [])).toEqual([]);
	});

	it('a manual Printed without runs is untouched when it was not a target', () => {
		const r = run({ partSlug: 'headrest-mount' });
		let v = logAll([r]);
		v = applyPatches(v, [{ slug: 'footrest', status: 'Printed', printedOn: '2026-02-02' }]);
		const out = recomputeParts(v, without(v, r.id), ['headrest-mount']);
		expect(out.map((p) => p.slug)).toEqual(['headrest-mount']);
	});
});
