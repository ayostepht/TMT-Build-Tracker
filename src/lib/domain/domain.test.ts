import { describe, expect, it } from 'vitest';
import { tmtTemplate } from '../server/seed/tmt.ts';
import {
	applyRun,
	estPerRun,
	filamentStats,
	fmt,
	fmtDur,
	fmtH,
	fmtHM,
	groupParts,
	jobNeverStarted,
	NO_PROGRESS_PCT,
	releaseUnstarted,
	nowPrinting,
	overallProgress,
	parseDur,
	runInfo,
	runTargets,
	setPrintStart,
	setStatus,
	validPrintedOn,
	startPrinting,
	betweenRuns,
	stopPrinting,
	timeStats,
	toLocalInput,
	today,
	unitUsed,
	units
} from './index.ts';
import { applyPatches, makeView, run } from './fixtures.ts';

const now = new Date(2026, 2, 5, 12, 0, 0);

/** Log a run the way the server would: compute patches against the old view, then append. */
function log(view: ReturnType<typeof makeView>, input: Parameters<typeof run>[0]) {
	const r = run(input);
	const patches = applyRun(view, r, now);
	return { ...applyPatches(view, patches), runs: [...view.runs, r] };
}

describe('format', () => {
	it('parseDur', () => {
		expect(parseDur('12:30')).toBe(12 * 3600 + 30 * 60);
		expect(parseDur('1.5')).toBe(5400);
		expect(parseDur('2h 15m')).toBe(8100);
		expect(parseDur('1d 2h')).toBe(93600);
		expect(parseDur('')).toBeNull();
		expect(parseDur('abc')).toBeNull();
	});
	it('formatters', () => {
		expect(fmt(12345.6)).toBe('12,346');
		expect(fmtH(3600 * 4.5)).toBe('4.5 h');
		expect(fmtH(3600 * 12)).toBe('12 h');
		expect(fmtDur(3 * 3600000 + 5 * 60000)).toBe('3h 05m');
		expect(fmtDur(-5)).toBe('0m');
		expect(fmtHM(47232)).toBe('13h 07m');
		expect(toLocalInput(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02T03:04');
		expect(today(new Date(2026, 0, 2, 23, 59))).toBe('2026-01-02');
	});
});

describe('accounting', () => {
	it('totals per role equal the BOM sums', () => {
		const v = makeView();
		const stats = filamentStats(v);
		expect(stats.map((s) => s.role)).toEqual(v.filaments.map((f) => f.key));
		for (const s of stats) {
			const bom = v.parts
				.filter((p) => p.role === s.role)
				.reduce((a, p) => a + (p.bomGrams || 0), 0);
			expect(s.total).toBeCloseTo(bom);
			expect(s.used).toBe(0);
			expect(s.need).toBeCloseTo(bom);
		}
	});

	it('slicer grams override BOM per run', () => {
		const v = makeView();
		const plate = v.plates.find((p) => p.number === 11)!;
		plate.slicerGrams = 150;
		const u = units(v).find((x) => x.plate === 11)!;
		expect(estPerRun(v, u)).toBe(150);
		const v2 = makeView();
		v2.plates.find((p) => p.number === 23)!.slicerGrams = 400;
		const tires = units(v2).find((x) => x.plate === 23)!;
		expect(estPerRun(v2, tires)).toBe(400);
		expect(filamentStats(v2).find((s) => s.role === 'tire')!.total).toBeGreaterThanOrEqual(800);
	});

	it('perPartRuns plate makes one unit per part, halving the BOM per run', () => {
		const v = makeView();
		const us = units(v).filter((u) => u.plate === 13);
		expect(us.map((u) => u.key)).toEqual(['rims-1-4', 'rims-2-3']);
		expect(estPerRun(v, us[0])).toBe(477 / 2);
	});

	it('unitUsed counts logged grams, or the estimate when printed with nothing logged', () => {
		let v = makeView();
		const u = () => units(v).find((x) => x.plate === 11)!;
		expect(unitUsed(v, u())).toBe(0);
		v = log(v, { plateNumber: 11, grams: 170 });
		expect(unitUsed(v, u())).toBe(170);
		// printed with nothing logged -> estimate
		const w = makeView();
		w.state['seat-center'].status = 'Printed';
		expect(
			unitUsed(
				w,
				units(w).find((x) => x.plate === 11)!
			)
		).toBe(180);
		// part-log grams count too
		const x = { ...makeView(), runs: [run({ partSlug: 'seat-center', grams: 99 })] };
		expect(
			unitUsed(
				x,
				units(x).find((y) => y.plate === 11)!
			)
		).toBe(99);
	});

	it('flags short filament', () => {
		const v = makeView();
		v.filaments[0].spools = 0.1;
		const s = filamentStats(v)[0];
		expect(s.short).toBe(true);
		expect(s.shortByGrams).toBeCloseTo(s.need + s.used - 100);
	});

	it('timeStats: pace ratio waits for 12 h of timed successful runs', () => {
		let v = makeView();
		expect(timeStats(v).leftSec).toBe(timeStats(v).totalSec);
		expect(timeStats(v).paceRatio).toBeNull();
		v = log(v, { plateNumber: 1, hours: 20 }); // est 13.1 h
		const t = timeStats(v);
		expect(t.paceRatio).toBeCloseTo(20 / (47232 / 3600));
		expect(t.adjustedLeftSec).toBeCloseTo(t.leftSec * t.paceRatio!);
		expect(t.loggedHours).toBe(20);
		let w = makeView();
		w = log(w, { plateNumber: 21, hours: 3 }); // est 4.1 h
		expect(timeStats(w).paceRatio).toBeNull();
		expect(timeStats(w).adjustedLeftSec).toBeNull();
		expect(timeStats(w).loggedHours).toBe(3);
		// total counts rim plate 4 times
		const plates = makeView().plates;
		const sum = plates.reduce(
			(a, p) => a + (p.estSeconds || 0) * (p.perPartRuns ? p.runs * p.parts.length : p.runs),
			0
		);
		expect(timeStats(makeView()).totalSec).toBe(sum);
	});

	it('overallProgress counts statuses', () => {
		const v = makeView();
		v.state['seat-center'].status = 'Printed';
		v.state['footrest'].status = 'Printing';
		const p = overallProgress(v);
		expect(p.total).toBe(v.parts.length);
		expect(p.printed).toBe(1);
		expect(p.printing).toBe(1);
		expect(p.toPrint).toBe(v.parts.length - 2);
		expect(p.pct).toBeCloseTo(100 / v.parts.length);
	});
});

describe('actions', () => {
	it('setStatus', () => {
		const v = makeView();
		expect(setStatus(v, 'seat-center', 'To print', now)).toEqual([]);
		const [p] = setStatus(v, 'seat-center', 'Printing', now);
		expect(p.startedAt).toBe(now.toISOString());
		const [q] = setStatus(v, 'seat-center', 'Printed', now);
		expect(q.printedOn).toBe('2026-03-05');
		expect(q.startedAt).toBeNull();
		const w = applyPatches(v, [q]);
		expect(setStatus(w, 'seat-center', 'To print', now)[0].printedOn).toBeNull();
	});

	it('setStatus restores a given printedOn only for Printed; validPrintedOn rejects bad dates', () => {
		const v = makeView();
		expect(
			setStatus(v, 'seat-center', 'Printed', now, { printedOn: '2026-02-01' })[0].printedOn
		).toBe('2026-02-01');
		expect(
			setStatus(v, 'seat-center', 'Printing', now, { printedOn: '2026-02-01' })[0].printedOn
		).toBe(undefined);
		expect(validPrintedOn('2026-03-05', now)).toBe(true);
		expect(validPrintedOn('2026-03-06', now)).toBe(false); // future
		expect(validPrintedOn('2026-02-30', now)).toBe(false); // not a date
		expect(validPrintedOn('2020-01-01', now)).toBe(true); // floor is inclusive
		expect(validPrintedOn('2019-12-31', now)).toBe(false); // before the floor
		expect(validPrintedOn('0000-01-01', now)).toBe(false);
		expect(validPrintedOn('5 March', now)).toBe(false);
		expect(validPrintedOn(20260301, now)).toBe(false);
	});

	it('a perPartRuns plate needs 2 Success runs per part before Printed', () => {
		let v = makeView();
		expect(runInfo(v, 13, 'rims-1-4')).toEqual({ run: 1, of: 2 });
		v = log(v, { plateNumber: 13, partSlug: 'rims-1-4' });
		expect(v.state['rims-1-4'].status).toBe('Printing');
		expect(v.state['rims-2-3'].status).toBe('To print');
		expect(runInfo(v, 13, 'rims-1-4')).toEqual({ run: 2, of: 2 });
		expect(runInfo(v, 13, 'rims-2-3')).toEqual({ run: 1, of: 2 });
		v = log(v, { plateNumber: 13, partSlug: 'rims-1-4', date: '2026-03-02' });
		expect(v.state['rims-1-4'].status).toBe('Printed');
		expect(v.state['rims-1-4'].printedOn).toBe('2026-03-02');
		expect(v.state['rims-2-3'].status).toBe('To print');
		// remaining time: 2 runs left for rims-2-3 only
		expect(timeStats(v).leftSec).toBe(timeStats(makeView()).leftSec - 2 * 34992);
	});

	it('single-run plate: runInfo null, success prints all parts, comps checked', () => {
		let v = makeView();
		expect(runInfo(v, 10)).toBeNull();
		v = log(v, { plateNumber: 10 });
		expect(v.state['seat-back-top'].status).toBe('Printed');
		expect(v.state['seat-back-bottom'].status).toBe('Printed');
	});

	it('failure -> Reprint unless already Printed', () => {
		let v = makeView();
		v = log(v, { plateNumber: 10, result: 'Failed' });
		expect(v.state['seat-back-top'].status).toBe('Reprint');
		v.state['seat-back-bottom'].status = 'Printed';
		v = log(v, { plateNumber: 10, result: 'Failed' });
		expect(v.state['seat-back-bottom'].status).toBe('Printed');
		expect(v.state['seat-back-top'].status).toBe('Reprint');
		// part log
		const w = makeView();
		const patches = applyRun(w, run({ partSlug: 'footrest', result: 'Failed' }), now);
		expect(patches[0].status).toBe('Reprint');
		expect(applyRun(w, run({ partSlug: 'footrest' }), now)[0]).toMatchObject({
			status: 'Printed',
			printedOn: '2026-03-01'
		});
	});

	it('runTargets: whole plate, subset, single part', () => {
		const v = makeView();
		expect(runTargets(v, run({ plateNumber: 12 })).length).toBe(3);
		expect(runTargets(v, run({ plateNumber: 12, partSlugs: ['hub-caps'] }))).toEqual(['hub-caps']);
		expect(runTargets(v, run({ plateNumber: 12, partSlug: 'connectors' }))).toEqual(['connectors']);
		expect(
			runTargets(
				v,
				run({ plateNumber: 12, partSlugs: v.plates.find((p) => p.number === 12)!.parts })
			).length
		).toBe(3);
		expect(runTargets(v, run({ partSlug: 'footrest' }))).toEqual(['footrest']);
	});

	it('stopPrinting returns to Printed if printedOn else To print', () => {
		let v = makeView();
		v = applyPatches(v, startPrinting(v, ['seat-center', 'footrest'], now));
		expect(v.state['footrest'].status).toBe('Printing');
		expect(startPrinting(v, ['footrest'], now)).toEqual([]);
		v.state['seat-center'].printedOn = '2026-02-01';
		const patches = stopPrinting(v, ['seat-center', 'footrest', 'handle-left']);
		expect(patches.find((p) => p.slug === 'seat-center')!.status).toBe('Printed');
		expect(patches.find((p) => p.slug === 'footrest')!.status).toBe('To print');
		expect(patches.find((p) => p.slug === 'handle-left')).toBeUndefined();
	});

	it('setPrintStart clamps to now', () => {
		const v = makeView();
		const future = new Date(now.getTime() + 3600000);
		expect(setPrintStart(v, ['footrest'], future, now)[0].startedAt).toBe(now.toISOString());
		const past = new Date(now.getTime() - 3600000);
		expect(setPrintStart(v, ['footrest'], past, now)[0].startedAt).toBe(past.toISOString());
		expect(setPrintStart(v, ['footrest'], new Date('x'), now)).toEqual([]);
	});
});

describe('now printing', () => {
	it('groups by plate with estimate sources and run info', () => {
		let v = makeView();
		v = applyPatches(v, startPrinting(v, ['footrest', 'rims-1-4', 'tires'], now));
		v.state['footrest'].runEstSeconds = 40000;
		const cards = nowPrinting(v);
		expect(cards.map((c) => c.plate)).toEqual([13, 23, 24]);
		const foot = cards.find((c) => c.plate === 24)!;
		expect(foot.estSource).toBe('slicer');
		expect(foot.estSeconds).toBe(40000);
		expect(foot.run).toBeNull();
		const rim = cards.find((c) => c.plate === 13)!;
		expect(rim.estSource).toBe('template');
		expect(rim.run).toEqual({ run: 1, of: 2 });
		expect(rim.gramsPerRun).toBe(477 / 2);
		expect(cards.find((c) => c.plate === 23)!.run).toEqual({ run: 1, of: 2 });
		expect(foot.startedAt).toBe(now.toISOString());
	});
});

describe('grouping', () => {
	it('groups by role, section, plate and hides printed', () => {
		const v = makeView();
		const byRole = groupParts(v, 'role', { role: 'all', hidePrinted: false });
		expect(byRole.map((g) => g.key)).toEqual(
			v.filaments.map((f) => f.key).filter((k) => byRole.some((g) => g.key === k))
		);
		expect(byRole.reduce((a, g) => a + g.parts.length, 0)).toBe(v.parts.length);
		const bySec = groupParts(v, 'section', { role: 'all', hidePrinted: false });
		expect(bySec.map((g) => g.key)).toEqual(tmtTemplate.sections);
		const byPlate = groupParts(v, 'plate', { role: 'all', hidePrinted: false });
		expect(byPlate[0].title).toBe('Plate 1 · Handle Left');
		expect(byPlate.map((g) => +g.key)).toEqual(
			[...byPlate.map((g) => +g.key)].sort((a, b) => a - b)
		);

		v.state['seat-center'].status = 'Printed';
		v.state['seat-back-top'].status = 'Printing';
		v.state['seat-back-bottom'].status = 'Reprint';
		const seat = groupParts(v, 'section', { role: 'all', hidePrinted: false })[0];
		expect(seat.parts.slice(0, 3).map((p) => p.slug)).toEqual([
			'seat-back-top',
			'seat-back-bottom',
			expect.any(String)
		]);
		expect(seat.parts.at(-1)!.slug).toBe('seat-center');
		expect(seat.meta).toMatch(/^1\/\d+ printed$/);
		const hidden = groupParts(v, 'section', { role: 'all', hidePrinted: true })[0];
		expect(hidden.parts.some((p) => p.slug === 'seat-center')).toBe(false);
		expect(hidden.meta).toBe(seat.meta);
		const primaryOnly = groupParts(v, 'section', { role: 'primary', hidePrinted: false });
		expect(primaryOnly.every((g) => g.parts.every((p) => p.role === 'primary'))).toBe(true);
	});
});

describe('variants and parts on no plate', () => {
	it('a part on no plate is its own unit with one run', async () => {
		const { units } = await import('./accounting.ts');
		const v = makeView(undefined, 0, { footrest: 'two-piece', seat: 'bucket-seat' });
		const us = units(v);
		expect(us.find((u) => u.parts.some((p) => p.slug === 'footrest'))).toBeUndefined();
		const front = us.find((u) => u.key === 'footrest-front')!;
		expect(front).toMatchObject({ plate: 0, runs: 1 });
		expect(us.find((u) => u.key === 'bucket-seat')).toBeDefined();
		// every active part is in exactly one unit
		const seen = us.flatMap((u) => u.parts.map((p) => p.slug)).sort();
		expect(seen).toEqual(v.parts.map((p) => p.slug).sort());
		// accounting does not blow up and counts only active parts
		expect(filamentStats(v).every((f) => Number.isFinite(f.need))).toBe(true);
		expect(overallProgress(v).total).toBe(v.parts.length);
	});
});

describe('printer job that never started', () => {
	it('uses one threshold: under 1% with no layer past the first', () => {
		expect(NO_PROGRESS_PCT).toBe(1);
		expect(jobNeverStarted({ progress: 0 })).toBe(true);
		expect(jobNeverStarted({ progress: 0.4, layer: 1 })).toBe(true);
		expect(jobNeverStarted({ progress: 1 })).toBe(false);
		expect(jobNeverStarted({ progress: 40, layer: 40 })).toBe(false);
		expect(jobNeverStarted({ progress: 0, layer: 2 })).toBe(false);
	});
	it('absent progress counts only when the job ended within minutes of its start', () => {
		expect(jobNeverStarted({ progress: null, elapsedSec: 120 })).toBe(true);
		expect(jobNeverStarted({ progress: null, elapsedSec: 3600 })).toBe(false);
		expect(jobNeverStarted({ progress: null })).toBe(false);
	});
	it('betweenRuns: Printing without a start time after a won run; startPrinting starts the next run', () => {
		const v0 = makeView();
		const plate = v0.plates.find((p) => p.perPartRuns)!;
		const [a, b] = plate.parts;
		let v = applyPatches(v0, startPrinting(v0, [a, b], now));
		expect(betweenRuns(v, a)).toBe(false); // started: on the printer
		v = log(v, { plateNumber: plate.number, partSlug: a, result: 'Success' });
		expect(v.state[a].status).toBe('Printing');
		expect(betweenRuns(v, a)).toBe(true);
		expect(betweenRuns(v, b)).toBe(false); // started, no run logged
		const again = startPrinting(v, [a], now);
		expect(again).toEqual([{ slug: a, status: 'Printing', startedAt: now.toISOString() }]);
		expect(betweenRuns(applyPatches(v, again), a)).toBe(false);
		// Between runs nothing is on the printer: the part is not in "Now printing".
		expect(nowPrinting(v).flatMap((c) => c.parts.map((p) => p.slug))).toEqual([b]);
	});
	it('releases Printing parts to To print, but a multi-run part between runs stays Printing', () => {
		const v0 = makeView();
		const plate = v0.plates.find((p) => p.perPartRuns)!;
		const [a, b] = plate.parts;
		let v = applyPatches(v0, startPrinting(v0, [a, b], now));
		v = log(v, { plateNumber: plate.number, partSlug: a, result: 'Success' });
		expect(v.state[a].status).toBe('Printing');
		const patches = releaseUnstarted(v, [a, b]);
		const v2 = applyPatches(v, patches);
		expect(v2.state[a].status).toBe('Printing');
		expect(v2.state[a].startedAt).toBeNull();
		expect(v2.state[b].status).toBe('To print');
		expect(releaseUnstarted(v0, [a])).toEqual([]); // not Printing: nothing to do
		// every run done, set back to Printing by hand: Printed again, not stuck on Printing
		let done = applyPatches(v0, startPrinting(v0, [a], now));
		for (let i = 0; i < plate.runs; i++)
			done = log(done, { plateNumber: plate.number, partSlug: a, result: 'Success' });
		done = applyPatches(done, [{ slug: a, status: 'Printing', startedAt: now.toISOString() }]);
		expect(applyPatches(done, releaseUnstarted(done, [a])).state[a].status).toBe('Printed');
		// a failure with no later success: Reprint
		let failed = applyPatches(v0, startPrinting(v0, [b], now));
		failed = log(failed, { plateNumber: plate.number, partSlug: b, result: 'Failed' });
		failed = applyPatches(failed, startPrinting(failed, [b], now));
		expect(failed.state[b].status).toBe('Printing');
		expect(applyPatches(failed, releaseUnstarted(failed, [b])).state[b].status).toBe('Reprint');
	});
});
