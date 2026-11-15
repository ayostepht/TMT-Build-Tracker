import { describe, expect, it } from 'vitest';
import { applyPatches, makeView, run } from './fixtures.ts';
import {
	buildStatsSummary,
	clampMonths,
	failureRates,
	filamentBreakdown,
	periodStart,
	plateTimes,
	progressSeries,
	projectFinish,
	runsByPeriod,
	shortDate,
	subMonths,
	workspaceStats,
	type BuildStatsSummary
} from './stats.ts';
import type { BuildView, PrintRun } from './types.ts';

// Sunday 15 Nov 2026, local noon (`today()` reads the local clock).
const NOW = new Date(2026, 10, 15, 12);

function withRuns(runs: Partial<PrintRun>[], v: BuildView = makeView()): BuildView {
	return { ...v, runs: runs.map(run) };
}
/** A plate with two or more parts and one run, for split Partials. */
function multiPartPlate(v: BuildView) {
	return v.plates.find((p) => p.parts.length >= 2 && p.runs === 1 && !p.perPartRuns)!;
}

describe('dates', () => {
	it('buckets by day, Monday week and month without the timezone', () => {
		expect(periodStart('2026-11-15', 'day')).toBe('2026-11-15');
		expect(periodStart('2026-11-15', 'week')).toBe('2026-11-09'); // Sunday belongs to the week before
		expect(periodStart('2026-11-09', 'week')).toBe('2026-11-09');
		expect(periodStart('2026-11-15', 'month')).toBe('2026-11-01');
		expect(subMonths('2026-03-31', 1)).toBe('2026-02-28');
		expect(subMonths('2026-01-15', 2)).toBe('2025-11-15');
		expect(shortDate('2026-11-05')).toBe('Nov 5');
		expect(shortDate('nope')).toBe('');
	});
	it('clamps months to 1-24, default 6', () => {
		expect(clampMonths(undefined)).toBe(6);
		expect(clampMonths('abc')).toBe(6);
		expect(clampMonths('')).toBe(6);
		expect(clampMonths(0)).toBe(1);
		expect(clampMonths(-4)).toBe(1);
		expect(clampMonths('99')).toBe(24);
		expect(clampMonths('3')).toBe(3);
		expect(clampMonths(2.6)).toBe(3);
	});
});

describe('runsByPeriod', () => {
	it('is zeros for an empty build, one entry per period', () => {
		const out = runsByPeriod(makeView(), { unit: 'week', from: '2026-11-02', to: '2026-11-15' });
		expect(out).toEqual([
			{ key: '2026-11-02', goodHours: 0, failedHours: 0 },
			{ key: '2026-11-09', goodHours: 0, failedHours: 0 }
		]);
	});
	it('splits good and failed hours; an old Partial row counts as failed', () => {
		const v = withRuns([
			{ plateNumber: 1, date: '2026-11-09', result: 'Success', hours: 10 },
			{ plateNumber: 1, date: '2026-11-15', result: 'Failed', hours: 2.5 },
			{ plateNumber: 2, date: '2026-11-12', result: 'Partial', hours: 4 },
			{ plateNumber: 2, date: '2026-11-08', result: 'Success', hours: 7 },
			{ plateNumber: 2, date: '2026-12-01', result: 'Success', hours: 9 }, // after `to`
			{ plateNumber: 2, date: '2026-11-10', result: 'Success', hours: null }
		]);
		const wk = runsByPeriod(v, { unit: 'week', from: '2026-11-02', to: '2026-11-15' });
		expect(wk).toEqual([
			{ key: '2026-11-02', goodHours: 7, failedHours: 0 },
			{ key: '2026-11-09', goodHours: 10, failedHours: 6.5 }
		]);
		const day = runsByPeriod(v, { unit: 'day', from: '2026-11-14', to: '2026-11-15' });
		expect(day).toEqual([
			{ key: '2026-11-14', goodHours: 0, failedHours: 0 },
			{ key: '2026-11-15', goodHours: 0, failedHours: 2.5 }
		]);
		const mo = runsByPeriod(v, { unit: 'month', from: '2026-10-20', to: '2026-12-31' });
		expect(mo.map((m) => m.key)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
		expect(mo[1]).toMatchObject({ goodHours: 17, failedHours: 6.5 });
		expect(mo[2].goodHours).toBe(9);
	});
	it('returns nothing for a bad or reversed range', () => {
		expect(runsByPeriod(makeView(), { unit: 'day', from: '2026-11-15', to: '2026-11-01' })).toEqual(
			[]
		);
		expect(runsByPeriod(makeView(), { unit: 'day', from: 'x', to: '2026-11-01' })).toEqual([]);
	});
	it('caps a huge range at the latest periods', () => {
		const out = runsByPeriod(makeView(), { unit: 'day', from: '1990-01-01', to: '2026-11-15' });
		expect(out.length).toBeLessThanOrEqual(1100);
		expect(out[out.length - 1].key).toBe('2026-11-15');
	});
});

describe('plateTimes', () => {
	it('is empty without runs', () => {
		expect(plateTimes(makeView())).toEqual([]);
	});
	it('compares the average timed run with the plate time (plate 1 is 13.12 h)', () => {
		const v = withRuns([
			{ plateNumber: 1, result: 'Success', hours: 12.4 },
			{ plateNumber: 1, result: 'Success', hours: 14.4 },
			{ plateNumber: 1, result: 'Failed', hours: 3 } // not a pace sample
		]);
		expect(plateTimes(v)).toEqual([
			{
				plate: 1,
				name: 'P1 Handle Left',
				runs: 2,
				actualHours: 13.4,
				estHours: 13.12,
				deltaHours: 0.28
			}
		]);
	});
	it('lists longest plates first', () => {
		const v = withRuns([
			{ plateNumber: 1, result: 'Success', hours: 12 },
			{ plateNumber: 3, result: 'Success', hours: 14 }
		]);
		expect(plateTimes(v).map((p) => p.plate)).toEqual([3, 1]);
	});
	it('keeps a plate with no estimate, with a null estimate', () => {
		const v = withRuns([{ plateNumber: 1, result: 'Success', hours: 5 }]);
		v.plates = v.plates.map((p) => (p.number === 1 ? { ...p, estSeconds: null } : p));
		expect(plateTimes(v)).toEqual([
			{
				plate: 1,
				name: 'P1 Handle Left',
				runs: 1,
				actualHours: 5,
				estHours: null,
				deltaHours: null
			}
		]);
	});
	it('ignores runs with no hours and part subsets of a plate', () => {
		const pl = multiPartPlate(makeView());
		const v = withRuns([
			{ plateNumber: pl.number, result: 'Success', hours: null },
			{ plateNumber: pl.number, result: 'Success', hours: 3, partSlugs: [pl.parts[0]] }
		]);
		expect(plateTimes(v)).toEqual([]);
	});
});

describe('filamentBreakdown', () => {
	it('lists every slot with stock and nothing used for an empty build', () => {
		const v = makeView();
		const out = filamentBreakdown(v);
		expect(out.map((f) => f.role)).toEqual(['primary', 'accent', 'soft', 'tire']);
		expect(out[0]).toMatchObject({ name: 'Overture Blue', keptG: 0, lostG: 0, haveG: 5000 });
		expect(out.every((f) => f.toPrintG > 0 || f.role === 'soft' || f.toPrintG === 0)).toBe(true);
		expect(out[0].hex).toMatch(/^#/);
	});
	it('splits kept and lost grams by role; old Partial rows are lost', () => {
		const v = makeView();
		const slug = v.plates[0].parts[0];
		const role = v.parts.find((p) => p.slug === slug)!.role;
		const w = withRuns([
			{ plateNumber: 1, result: 'Success', grams: 100 },
			{ plateNumber: 1, result: 'Failed', grams: 40 },
			{ plateNumber: 1, result: 'Partial', grams: 10 }
		]);
		const f = filamentBreakdown(w).find((x) => x.role === role)!;
		expect(f.keptG).toBe(100);
		expect(f.lostG).toBe(50);
	});
	it('handles a split Partial: kept half to kept, failed half to lost', () => {
		const v = makeView();
		const pl = multiPartPlate(v);
		const keep = pl.parts[0];
		const lose = pl.parts.slice(1);
		const w = withRuns([
			{ plateNumber: pl.number, partSlugs: [keep], result: 'Success', grams: 60 },
			{ plateNumber: pl.number, partSlugs: lose, result: 'Failed', grams: 25 }
		]);
		const total = filamentBreakdown(w).reduce((a, f) => ({ k: a.k + f.keptG, l: a.l + f.lostG }), {
			k: 0,
			l: 0
		});
		expect(total).toEqual({ k: 60, l: 25 });
	});
	it('reports a shortfall against stock', () => {
		const v = makeView();
		v.filaments = v.filaments.map((f) => (f.key === 'primary' ? { ...f, spools: 0.1 } : f));
		const f = filamentBreakdown(v).find((x) => x.role === 'primary')!;
		expect(f.haveG).toBe(100);
		expect(f.shortG).toBeGreaterThan(0);
	});
});

describe('failureRates', () => {
	it('is empty for an empty build', () => {
		expect(failureRates(makeView())).toEqual({
			total: { runs: 0, failed: 0, rate: 0 },
			byPlate: [],
			byPrinter: []
		});
	});
	it('counts all-failed runs at 100%', () => {
		const out = failureRates(
			withRuns([
				{ plateNumber: 1, result: 'Failed', hours: 2, printer: 'CC1' },
				{ plateNumber: 1, result: 'Failed', hours: 3, printer: 'CC1' }
			])
		);
		expect(out.total).toEqual({ runs: 2, failed: 2, rate: 1 });
		expect(out.byPlate).toEqual([
			{ plate: 1, name: 'P1 Handle Left', runs: 2, failed: 2, rate: 1 }
		]);
		expect(out.byPrinter).toEqual([
			{ printer: 'CC1', runs: 2, failed: 2, rate: 1, hours: 5, failedHours: 5 }
		]);
	});
	it('rates per plate and per printer, worst first; old Partial is a failure', () => {
		const out = failureRates(
			withRuns([
				{ plateNumber: 1, result: 'Success', hours: 10, printer: 'CC1' },
				{ plateNumber: 1, result: 'Partial', hours: 4, printer: 'CC1' },
				{ plateNumber: 2, result: 'Success', hours: 10, printer: ' CC2 ' },
				{ plateNumber: 2, result: 'Success', hours: 10, printer: 'CC2' },
				{ plateNumber: 3, result: 'Success', hours: 9, printer: null },
				{ partSlug: 'handle-left', result: 'Failed', hours: 1, printer: 'CC2' }
			])
		);
		expect(out.total).toMatchObject({ runs: 6, failed: 2 });
		expect(out.byPlate.map((p) => [p.plate, p.rate])).toEqual([
			[1, 0.5],
			[2, 0],
			[3, 0]
		]);
		const cc2 = out.byPrinter.find((p) => p.printer === 'CC2')!;
		expect(cc2).toMatchObject({ runs: 3, failed: 1, hours: 21, failedHours: 1 });
		expect(out.byPrinter.find((p) => p.printer === null)).toMatchObject({ runs: 1, failed: 0 });
		expect(out.byPrinter[0].printer).toBe('CC1');
	});
	it('counts a split Partial as one failed print, hours still split', () => {
		const pl = multiPartPlate(makeView());
		const out = failureRates(
			withRuns([
				{
					plateNumber: pl.number,
					partSlugs: [pl.parts[0]],
					result: 'Success',
					hours: 6,
					date: '2026-11-01'
				},
				{
					plateNumber: pl.number,
					partSlugs: pl.parts.slice(1),
					result: 'Failed',
					hours: 2,
					date: '2026-11-01'
				}
			])
		);
		expect(out.total).toEqual({ runs: 1, failed: 1, rate: 1 });
		expect(out.byPlate[0]).toMatchObject({ runs: 1, failed: 1 });
		expect(out.byPrinter[0]).toMatchObject({ hours: 8, failedHours: 2 });
	});
});

describe('progressSeries', () => {
	it('starts at zero on the creation day for an empty build', () => {
		const s = progressSeries(makeView());
		expect(s.points).toEqual([{ x: '2026-01-01', y: 0 }]);
		expect(s.partPoints).toEqual([{ x: '2026-01-01', y: 0 }]);
		expect(s.markers).toEqual([]);
		expect(s.platesTotal).toBe(makeView().plates.length);
		expect(s.partsTotal).toBe(33);
	});
	it('counts a plate once all its parts are printed, with failure markers on the line', () => {
		let v = makeView();
		v = applyPatches(v, [
			{ slug: 'handle-left', status: 'Printed', printedOn: '2026-03-02' },
			{ slug: 'handle-right', status: 'Printed', printedOn: '2026-03-02' },
			{ slug: 'wheel-mount-left', status: 'Printed', printedOn: null }
		]);
		v.runs = [
			run({ plateNumber: 5, result: 'Failed', date: '2026-03-01' }),
			run({ plateNumber: 3, result: 'Success', date: '2026-03-04' })
		];
		const s = progressSeries(v);
		expect(s.points).toEqual([
			{ x: '2026-01-01', y: 0 },
			{ x: '2026-03-01', y: 0 },
			{ x: '2026-03-02', y: 2 },
			{ x: '2026-03-04', y: 3 } // no printedOn: the plate's last successful run
		]);
		expect(s.partPoints.at(-1)).toEqual({ x: '2026-03-04', y: 3 });
		expect(s.markers).toHaveLength(1);
		expect(s.markers[0]).toMatchObject({ x: '2026-03-01', tone: 'bad' });
		expect(s.markers[0].label).toContain('P5');
		expect(s.points.some((p) => p.x === s.markers[0].x)).toBe(true);
	});
	it('does not mark the kept half of a split Partial', () => {
		const v = makeView();
		const pl = multiPartPlate(v);
		v.runs = [
			run({
				plateNumber: pl.number,
				partSlugs: [pl.parts[0]],
				result: 'Success',
				date: '2026-03-01'
			}),
			run({
				plateNumber: pl.number,
				partSlugs: pl.parts.slice(1),
				result: 'Failed',
				date: '2026-03-01'
			})
		];
		expect(progressSeries(v).markers).toHaveLength(1);
	});
});

describe('projectFinish', () => {
	const recent = (n: number, hours = 12) =>
		Array.from({ length: n }, (_, i) => ({
			plateNumber: 1,
			date: `2026-11-${String(15 - i * 2).padStart(2, '0')}`,
			result: 'Success' as const,
			hours
		}));
	it('is not-enough with fewer than 3 runs in the window', () => {
		expect(projectFinish(makeView(), NOW)).toEqual({ kind: 'not-enough', runs: 0 });
		expect(projectFinish(withRuns(recent(2)), NOW)).toEqual({ kind: 'not-enough', runs: 2 });
	});
	it('does not count runs older than 28 days or without hours', () => {
		const v = withRuns([
			...recent(2),
			{ plateNumber: 1, date: '2026-09-01', result: 'Success', hours: 12 },
			{ plateNumber: 1, date: '2026-11-14', result: 'Success', hours: null }
		]);
		expect(projectFinish(v, NOW)).toEqual({ kind: 'not-enough', runs: 2 });
	});
	it('projects from hours per calendar day since the first run in the window', () => {
		const v = withRuns(recent(3)); // 36 h over 15 Nov back to 11 Nov: 5 days
		const p = projectFinish(v, NOW);
		expect(p.kind).toBe('projected');
		if (p.kind !== 'projected') return;
		expect(p.days).toBe(5);
		expect(p.runs).toBe(3);
		expect(p.hoursPerDay).toBe(7.2);
		expect(p.hoursLeft).toBeGreaterThan(100);
		expect(p.date > '2026-11-15').toBe(true);
	});
	it('says done when every part is printed, and no-estimate without plate times', () => {
		const v = withRuns(recent(3));
		const done = applyPatches(
			v,
			v.parts.map((p) => ({ slug: p.slug, status: 'Printed' }))
		);
		expect(projectFinish(done, NOW)).toEqual({ kind: 'done' });
		const bare = { ...v, plates: v.plates.map((p) => ({ ...p, estSeconds: null })) };
		expect(projectFinish(bare, NOW)).toEqual({ kind: 'no-estimate' });
	});
});

describe('buildStatsSummary', () => {
	it('carries no personal data', () => {
		const v = withRuns([
			{
				plateNumber: 1,
				result: 'Success',
				hours: 3,
				userId: 'u-secret',
				userName: 'Pat Maker',
				note: 'for Sam'
			}
		]);
		v.build.recipient = 'Recipient Name';
		v.build.hospital = 'Hospital Name';
		v.handoff = {
			recipientName: 'Recipient Name',
			organization: 'Org',
			contact: 'x@example.test',
			handedOffOn: '2026-05-01',
			location: null,
			notes: '',
			safetyChecked: true,
			updatedBy: 'u-secret',
			updatedAt: null
		};
		const json = JSON.stringify(buildStatsSummary(v));
		for (const s of [
			'Pat Maker',
			'u-secret',
			'for Sam',
			'Recipient Name',
			'Hospital Name',
			'x@example'
		])
			expect(json).not.toContain(s);
		expect(buildStatsSummary(v)).toMatchObject({
			handedOffOn: '2026-05-01',
			keptHours: 3,
			lostHours: 0
		});
	});
	it('handles an empty build', () => {
		const s = buildStatsSummary(makeView());
		expect(s).toMatchObject({ partsTotal: 33, partsPrinted: 0, keptHours: 0, runs: [] });
		expect(s.filaments).toHaveLength(4);
	});
});

function summary(over: Partial<BuildStatsSummary> & { id: string }): BuildStatsSummary {
	return {
		name: over.id,
		phase: 'printing',
		handedOffOn: null,
		createdOn: '2026-01-01',
		plateKeyPrefix: 't#',
		partsTotal: 33,
		partsPrinted: 10,
		keptHours: 0,
		lostHours: 0,
		filaments: [],
		plateNames: { 1: 'Handle Left', 2: 'Handle Right' },
		runs: [],
		...over
	};
}
const sr = (
	date: string,
	hours: number,
	over: Partial<BuildStatsSummary['runs'][number]> = {}
) => ({
	date,
	hours,
	good: true,
	printer: 'CC1' as string | null,
	plate: 1 as number | null,
	counts: true,
	...over
});

describe('workspaceStats', () => {
	it('is all zeros for no builds', () => {
		const w = workspaceStats([], { months: 3, now: NOW });
		expect(w.months).toBe(3);
		expect(w.from).toBe('2026-08-15');
		expect(w.to).toBe('2026-11-15');
		expect(w.kpis.builds).toEqual({ total: 0, finished: 0, inProgress: 0 });
		expect(w.kpis.perChair).toBeNull();
		expect(w.weekly.every((x) => x.goodHours === 0 && x.failedHours === 0)).toBe(true);
		expect(w.printers).toEqual([]);
		expect(w.builds).toEqual([]);
	});
	it('defaults to 6 months and clamps', () => {
		expect(workspaceStats([], { now: NOW }).months).toBe(6);
		expect(workspaceStats([], { months: 500, now: NOW }).months).toBe(24);
		expect(workspaceStats([], { months: -1, now: NOW }).months).toBe(1);
	});
	it('aggregates hours, printers, filaments and failing plates; finished means handed off', () => {
		const a = summary({
			id: 'a',
			keptHours: 30,
			lostHours: 10,
			handedOffOn: '2026-10-01',
			phase: 'printing', // phase is ignored: the handoff date decides
			filaments: [
				{ name: 'Blue', material: 'PETG', hex: '#00f', keptG: 5000, lostG: 500, stockKg: 6 },
				{ name: 'Black', material: 'TPU', hex: '#000', keptG: 900, lostG: 0, stockKg: 1 }
			],
			runs: [
				sr('2026-10-01', 10),
				sr('2026-10-02', 10),
				sr('2026-10-03', 10, { good: false }),
				sr('2026-10-04', 10, { good: false, printer: 'CC2' }),
				sr('2026-10-05', 0, { good: false, plate: 2 }),
				sr('2026-01-01', 99) // outside a 3-month window
			]
		});
		const b = summary({
			id: 'b',
			keptHours: 5,
			filaments: [
				{ name: 'blue', material: 'petg', hex: '#00f', keptG: 1000, lostG: 100, stockKg: 1 }
			],
			runs: [sr('2026-11-10', 5, { printer: 'CC2' })]
		});
		const old = summary({
			id: 'old',
			keptHours: 50,
			handedOffOn: '2025-03-01',
			createdOn: '2025-01-01',
			runs: [sr('2025-02-01', 50)]
		});
		const w = workspaceStats([a, b, old], { months: 3, now: NOW });
		expect(w.kpis.builds).toEqual({ total: 2, finished: 1, inProgress: 1 });
		expect(w.kpis.hours).toMatchObject({ total: 45, good: 25, lost: 20, printDays: 5 });
		expect(w.kpis.hours.lostShare).toBeCloseTo(20 / 45);
		expect(w.kpis.filament).toEqual({ keptKg: 6.9, lostKg: 0.6, stockKg: 8 });
		// per-chair uses every finished build with hours, even outside the window
		expect(w.kpis.perChair).toEqual({ builds: 2, hours: 45, kg: 3.2 });
		expect(w.printers.map((p) => [p.printer, p.hours, p.failedHours, p.runs, p.failed])).toEqual([
			['CC1', 30, 10, 4, 2],
			['CC2', 15, 10, 2, 1]
		]);
		expect(w.topFilaments.map((f) => [f.name, f.keptG, f.lostG])).toEqual([
			['Blue', 6000, 600],
			['Black', 900, 0]
		]);
		// plate 1: 5 prints in the window (4 in a, 1 in b), 2 failed (min 3 runs reached)
		expect(w.failingPlates).toHaveLength(1);
		expect(w.failingPlates[0]).toMatchObject({ label: 'P1 Handle Left', runs: 5, failed: 2 });
		expect(w.weekly.reduce((s, x) => s + x.goodHours + x.failedHours, 0)).toBe(45);
		expect(w.builds.map((r) => r.id)).toEqual(['b', 'a']); // in progress first
		expect(w.builds.find((r) => r.id === 'a')).toMatchObject({
			finished: true,
			hours: 40,
			kg: 6.4,
			days: 5
		});
	});
	it('leaves out plates with fewer than 3 runs and plates that never failed', () => {
		const a = summary({
			id: 'a',
			runs: [sr('2026-11-01', 1, { good: false }), sr('2026-11-02', 1, { good: false })]
		});
		expect(workspaceStats([a], { now: NOW }).failingPlates).toEqual([]);
		const b = summary({ id: 'b', runs: [1, 2, 3].map((d) => sr(`2026-11-0${d}`, 1)) });
		expect(workspaceStats([b], { now: NOW }).failingPlates).toEqual([]);
	});
	it('does not merge plates of different kits or the kept half of a split', () => {
		const mk = (id: string, prefix: string) =>
			summary({
				id,
				plateKeyPrefix: prefix,
				runs: [
					sr('2026-11-01', 1, { good: false }),
					sr('2026-11-02', 1, { good: false }),
					sr('2026-11-03', 1, { good: true, counts: false })
				]
			});
		const w = workspaceStats([mk('a', 'k1#'), mk('b', 'k2#')], { now: NOW });
		expect(w.failingPlates).toEqual([]); // 2 prints each, never 3 together
	});
});

describe('split Partial pairing is order independent', () => {
	const mk = (failedFirst: boolean, extra: Partial<PrintRun>[] = []) => {
		const v = makeView();
		const pl = multiPartPlate(v);
		const ok = {
			plateNumber: pl.number,
			partSlugs: [pl.parts[0]],
			result: 'Success' as const,
			hours: 6,
			printer: 'CC1',
			date: '2026-11-01'
		};
		const bad = {
			plateNumber: pl.number,
			partSlugs: pl.parts.slice(1),
			result: 'Failed' as const,
			hours: 2,
			printer: 'CC1',
			date: '2026-11-01'
		};
		return withRuns([...(failedFirst ? [bad, ok] : [ok, bad]), ...extra], v);
	};
	it('failureRates is identical either way', () => {
		const a = failureRates(mk(false));
		const b = failureRates(mk(true));
		expect(b).toEqual(a);
		expect(a.total).toEqual({ runs: 1, failed: 1, rate: 1 });
		expect(a.byPlate[0]).toMatchObject({ runs: 1, failed: 1, rate: 1 });
		expect(a.byPrinter[0]).toMatchObject({ runs: 1, failed: 1, hours: 8, failedHours: 2 });
	});
	it('buildStatsSummary and workspaceStats are identical either way', () => {
		const a = buildStatsSummary(mk(false));
		const b = buildStatsSummary(mk(true));
		const byHours = (r: typeof a.runs) => [...r].sort((x, y) => x.hours - y.hours);
		expect(byHours(b.runs)).toEqual(byHours(a.runs));
		expect(a.runs.filter((r) => r.counts && !r.good)).toHaveLength(1);
		expect(a.runs.filter((r) => r.counts)).toHaveLength(1);
		const wa = workspaceStats([{ ...a, id: 'x' }], { now: NOW });
		const wb = workspaceStats([{ ...b, id: 'x' }], { now: NOW });
		expect(wb.printers).toEqual(wa.printers);
		expect(wb.failingPlates).toEqual(wa.failingPlates);
	});
	it('does not merge unrelated same-day runs on one plate', () => {
		const v = makeView();
		const pl = multiPartPlate(v);
		const base = { plateNumber: pl.number, date: '2026-11-01', printer: 'CC1' };
		const rows: Partial<PrintRun>[] = [
			{ ...base, result: 'Success', hours: 5 },
			{ ...base, result: 'Failed', hours: 1 },
			{ ...base, partSlugs: [pl.parts[0]], result: 'Success', note: 'a' },
			{ ...base, partSlugs: pl.parts.slice(1), result: 'Failed', note: 'b' }
		];
		for (const order of [rows, [...rows].reverse()]) {
			const out = failureRates(withRuns(order, v));
			expect(out.total).toEqual({ runs: 4, failed: 2, rate: 0.5 });
		}
	});
});
