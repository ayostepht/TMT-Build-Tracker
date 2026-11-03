import { describe, expect, it } from 'vitest';
import { elapsedSeconds, hoursFromSeconds, runOutcomeSummary, snapshotParts } from './logrun.ts';
import { makeView } from './fixtures.ts';
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
