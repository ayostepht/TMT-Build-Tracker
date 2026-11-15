import { describe, expect, it } from 'vitest';
import { makeView, run } from './fixtures.ts';
import { buildKpis } from './kpis.ts';
import { projectFinish } from './stats-core.ts';
import type { BuildView, PrintRun } from './types.ts';

const NOW = new Date(2026, 10, 15, 12);

function withRuns(runs: Partial<PrintRun>[], v: BuildView = makeView()): BuildView {
	return { ...v, runs: runs.map(run) };
}

describe('buildKpis', () => {
	it('rounds all three hours to one decimal under 100 h', () => {
		const k = buildKpis(
			withRuns([
				{ plateNumber: 1, result: 'Success', hours: 30.04 },
				{ plateNumber: 1, result: 'Failed', hours: 1.46 }
			]),
			NOW
		);
		expect(k.time).toMatchObject({ loggedH: 31.5, goodH: 30, failedH: 1.5, value: '31.5' });
		expect(k.time.label).toBe('31.5 h');
		expect(k.time.detail).toBe('30 h good · 1.5 h failed');
	});
	it('rounds all three to whole hours at 100 h and above', () => {
		const k = buildKpis(
			withRuns([
				{ plateNumber: 1, result: 'Success', hours: 267.2 },
				{ plateNumber: 1, result: 'Failed', hours: 71.6 }
			]),
			NOW
		);
		expect(k.time).toMatchObject({ loggedH: 339, goodH: 267, failedH: 72, value: '339' });
		expect(k.time.label).toBe('339 h');
		expect(k.time.detail).toBe('267 h good · 72 h failed');
		const edge = buildKpis(
			withRuns([
				{ plateNumber: 1, result: 'Success', hours: 99.9 },
				{ plateNumber: 1, result: 'Failed', hours: 0.1 }
			]),
			NOW
		);
		expect(edge.time.label).toBe('100 h');
		expect(edge.time.detail).toBe('100 h good · 0 h failed');
	});
	it('reports parts, filament and the finish projection', () => {
		const v = withRuns([
			{ plateNumber: 1, result: 'Failed', hours: 2, grams: 50, date: '2026-11-10' }
		]);
		const k = buildKpis(v, NOW);
		expect(k.parts.printed).toBe(0);
		expect(k.parts.total).toBe(v.parts.length);
		expect(k.parts.label).toBe(`0 of ${v.parts.length}`);
		expect(k.parts.detail).toMatch(/ · 1 failed print$/);
		expect(k.filament.usedKg).toBe(k.filament.keptKg + k.filament.lostKg);
		expect(k.finish.projection).toEqual(projectFinish(v, NOW));
		expect(k.finish.label).toBe('Not yet');
		expect(k.finish.detail).toBe('Needs 3 prints in the last 28 days (1 so far)');
	});
	it('is empty-safe', () => {
		const k = buildKpis(makeView(), NOW);
		expect(k.time.label).toBe('0 h');
		expect(k.filament.label).toBe('0 g');
	});
});
