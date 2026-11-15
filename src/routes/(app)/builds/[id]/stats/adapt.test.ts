import { describe, expect, it } from 'vitest';
import { makeView, run } from '#lib/domain/fixtures.ts';
import { buildStats } from './adapt.ts';

const NOW = new Date(2026, 10, 15, 12);

describe('build stats adapter', () => {
	it('is empty without runs', () => {
		expect(buildStats(makeView(), NOW).empty).toBe(true);
	});

	it('maps runs to tiles, tones and sentences', () => {
		const v = makeView();
		const view = {
			...v,
			runs: [
				run({ plateNumber: 1, date: '2026-11-10', result: 'Success', hours: 10 }),
				run({ plateNumber: 1, date: '2026-11-12', result: 'Failed', hours: 4 }),
				run({ plateNumber: 2, date: '2026-11-14', result: 'Success', hours: 6 })
			]
		};
		const s = buildStats(view, NOW);
		expect(s.empty).toBe(false);
		expect(s.tiles.map((t) => t.key)).toEqual(['time', 'filament', 'parts', 'finish']);
		expect(s.tiles[0].value).toBe('20');
		expect(s.tiles[0].split).toEqual([
			{ value: 16, tone: 'good' },
			{ value: 4, tone: 'bad' }
		]);
		expect(s.failures.rows).not.toBeNull();
		expect(s.failures.summary).toMatch(/^1 of 3 prints failed \(33%\)/);
		expect(s.time?.categories[0]).toBe('Nov 10');
		expect(s.time?.failed.reduce((a, b) => a + b, 0)).toBe(4);
		expect(s.progress?.points.every((p, i, a) => i === 0 || p.y >= a[i - 1].y)).toBe(true);
		// days are unique labels, so the chart slots line up
		const xs = s.progress!.points.map((p) => p.x);
		expect(new Set(xs).size).toBe(xs.length);
	});

	it('says so when nothing failed', () => {
		const v = makeView();
		const s = buildStats(
			{ ...v, runs: [run({ plateNumber: 1, date: '2026-11-10', result: 'Success', hours: 5 })] },
			NOW
		);
		expect(s.failures.rows).toBeNull();
		expect(s.failures.summary).toMatch(/^No failed prints/);
	});

	it('gives a swatch only for a #rrggbb hex', () => {
		const v = makeView();
		const runs = [run({ plateNumber: 1, date: '2026-11-10', result: 'Success', hours: 5 })];
		const rows = (hex: string) =>
			buildStats({ ...v, runs, filaments: v.filaments.map((f) => ({ ...f, hex })) }, NOW).filament
				?.rows ?? [];
		expect(rows('#1a2B3c').every((r) => r.swatch === '#1a2B3c')).toBe(true);
		const bad = rows('red;background:url(x)');
		expect(bad.length).toBeGreaterThan(0);
		expect(bad.every((r) => r.swatch === undefined)).toBe(true);
	});
});
