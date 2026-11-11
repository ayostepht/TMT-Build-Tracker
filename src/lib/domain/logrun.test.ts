import { describe, expect, it } from 'vitest';
import {
	elapsedSeconds,
	hoursFromSeconds,
	partRuns,
	progressGrams,
	runOutcomeSummary,
	snapshotParts
} from './logrun.ts';
import { makeView, run } from './fixtures.ts';
import type { PrintRunInput, RunResult } from './types.ts';

describe('elapsedSeconds / hoursFromSeconds', () => {
	const now = new Date('2026-01-01T12:00:00Z');
	it('measures start to finish, clamped to now', () => {
		expect(elapsedSeconds('2026-01-01T10:00:00Z', new Date('2026-01-01T11:30:00Z'), now)).toBe(
			5400
		);
		expect(elapsedSeconds('2026-01-01T10:00:00Z', new Date('2026-01-02T00:00:00Z'), now)).toBe(
			7200
		);
	});
	it('is null without a usable start', () => {
		expect(elapsedSeconds(null, now, now)).toBeNull();
		expect(elapsedSeconds('2026-01-01T13:00:00Z', now, now)).toBeNull();
	});
	it('rounds hours to 0.1', () => {
		expect(hoursFromSeconds(9000)).toBe(2.5);
		expect(hoursFromSeconds(47220)).toBe(13.1);
		expect(hoursFromSeconds(null)).toBeNull();
	});
});

describe('runOutcomeSummary / snapshotParts', () => {
	const view = makeView();
	const plate = view.plates[0];
	const base = (
		over: Partial<PrintRunInput>
	): Omit<PrintRunInput, 'result'> & { result: RunResult | null } => ({
		plateNumber: plate.number,
		partSlug: null,
		partSlugs: null,
		date: '2026-01-01',
		result: null,
		grams: null,
		hours: null,
		printer: null,
		note: '',
		...over
	});
	it('is empty until a result is chosen', () => {
		expect(runOutcomeSummary(view, base({}))).toBe('');
	});
	it('describes success and failure', () => {
		const name = view.parts.find((p) => p.slug === plate.parts[0])!.name;
		if (plate.runs <= 1 && !plate.perPartRuns) {
			expect(runOutcomeSummary(view, { ...base({}), result: 'Success' })).toContain('Marks');
		}
		expect(runOutcomeSummary(view, { ...base({}), result: 'Failed' })).toContain('reprint');
		expect(name.length).toBeGreaterThan(0);
	});
	it('snapshots a copy of the state', () => {
		const [s] = snapshotParts(view, [plate.parts[0]]);
		expect(s.status).toBe(view.state[plate.parts[0]].status);
		expect(s.comps).not.toBe(view.state[plate.parts[0]].comps);
	});
});

describe('partRuns', () => {
	const base = makeView();
	const multi = base.plates.find((p) => p.parts.length >= 2)!;
	const [a, b] = multi.parts;
	const other = base.plates.find((p) => p.number !== multi.number)!;
	const withRuns = (runs: ReturnType<typeof run>[]) => ({ ...base, runs });

	it('includes a part-only run and ignores another part', () => {
		const mine = run({ partSlug: a });
		expect(partRuns(withRuns([mine, run({ partSlug: b })]), a)).toEqual([mine]);
	});
	it('includes a whole-plate run (partSlugs null) for every part on the plate', () => {
		const r = run({ plateNumber: multi.number });
		for (const s of multi.parts) expect(partRuns(withRuns([r]), s)).toEqual([r]);
	});
	it('a subset plate run only covers the listed parts', () => {
		const r = run({ plateNumber: multi.number, partSlugs: [a] });
		expect(partRuns(withRuns([r]), a)).toEqual([r]);
		expect(partRuns(withRuns([r]), b)).toEqual([]);
	});
	it('a plate run with partSlug set covers only that part', () => {
		const r = run({ plateNumber: multi.number, partSlug: a });
		expect(partRuns(withRuns([r]), a)).toEqual([r]);
		expect(partRuns(withRuns([r]), b)).toEqual([]);
	});
	it('ignores a plate run on a plate the part is not on', () => {
		expect(partRuns(withRuns([run({ plateNumber: other.number })]), a)).toEqual([]);
	});
	it('keeps view.runs order', () => {
		const r1 = run({ plateNumber: multi.number });
		const r2 = run({ partSlug: a });
		const r3 = run({ plateNumber: multi.number, partSlugs: [a] });
		expect(partRuns(withRuns([r1, r2, r3]), a)).toEqual([r1, r2, r3]);
	});
});

describe('progressGrams', () => {
	it('scales the grams by progress and rounds', () => {
		expect(progressGrams(41, 40)).toBe(16);
		expect(progressGrams(140, 100)).toBe(140);
		expect(progressGrams(140, 250)).toBe(140);
	});
	it('is null when unknown or zero', () => {
		expect(progressGrams(null, 40)).toBeNull();
		expect(progressGrams(41, null)).toBeNull();
		expect(progressGrams(41, 0)).toBeNull();
		expect(progressGrams(10, 2)).toBeNull(); // rounds to 0
	});
});
