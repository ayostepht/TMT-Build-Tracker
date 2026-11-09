import { describe, expect, it } from 'vitest';
import { defaultRunParts, runChoices } from './run-choice.ts';
import { applyPatches, makeView, run } from './fixtures.ts';

const win = (slug: string) => run({ plateNumber: 13, partSlug: slug });
const printingOf = (slug: string) => ({ slug, status: 'Printing' as const });

describe('defaultRunParts', () => {
	it('is null for plates that are not perPartRuns', () => {
		expect(defaultRunParts(makeView(), 1)).toBeNull();
		expect(runChoices(makeView(), 1)).toEqual([]);
	});

	it('picks the first part with runs left when nothing is printing', () => {
		expect(defaultRunParts(makeView(), 13)).toEqual(['rims-1-4']);
	});

	it('picks the one part that is already Printing', () => {
		const v = applyPatches(makeView(), [printingOf('rims-2-3')]);
		expect(defaultRunParts(v, 13)).toEqual(['rims-2-3']);
	});

	it('skips a part with all its runs done and a part that is Printed', () => {
		const v = { ...makeView(), runs: [win('rims-1-4'), win('rims-1-4')] };
		expect(defaultRunParts(v, 13)).toEqual(['rims-2-3']);
		const one = { ...makeView(), runs: [win('rims-1-4')] };
		expect(defaultRunParts(one, 13)).toEqual(['rims-1-4']); // 1 of 2 done: still has a run
		const printed = applyPatches(makeView(), [{ slug: 'rims-1-4', status: 'Printed' }]);
		expect(defaultRunParts(printed, 13)).toEqual(['rims-2-3']);
	});

	it('with both parts Printing it takes the first with runs left, never both', () => {
		const v = applyPatches(makeView(), [printingOf('rims-1-4'), printingOf('rims-2-3')]);
		expect(defaultRunParts(v, 13)).toEqual(['rims-1-4']);
	});

	it('with everything done it still returns a single part', () => {
		const v = {
			...makeView(),
			runs: ['rims-1-4', 'rims-1-4', 'rims-2-3', 'rims-2-3'].map(win)
		};
		expect(defaultRunParts(v, 13)).toHaveLength(1);
	});

	it('counts runs done and total per part', () => {
		const v = { ...makeView(), runs: [win('rims-2-3')] };
		expect(runChoices(v, 13)).toMatchObject([
			{ slug: 'rims-1-4', done: 0, total: 2 },
			{ slug: 'rims-2-3', done: 1, total: 2 }
		]);
	});
});
