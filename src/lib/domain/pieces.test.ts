/**
 * "Print some pieces…": a part with several pieces (Harness and Straps: 9 pieces, alone on plate 18)
 * goes on the printer a few pieces at a time. The part is Printing with `printingComps`; a run with
 * `comps` ticks exactly those pieces (all ticked = Printed, else back to To print) or, failed, flags
 * Reprint. Undo, edits and deletes replay the ticks; hand ticks, Stop and hand-set statuses keep the
 * piece list consistent; accounting counts the pieces left.
 */
import { describe, expect, it } from 'vitest';
import {
	applyRun,
	canPrintPieces,
	describeActivity,
	filamentStats,
	leftShare,
	nowPrinting,
	paceOf,
	pieceListError,
	pieceShare,
	piecesLeft,
	printGrams,
	recomputeParts,
	releaseUnstarted,
	runOutcomeSummary,
	setPieceTicks,
	setStatus,
	snapshotParts,
	startPrinting,
	stopPrinting,
	subsetShare,
	timeStats,
	unitLeft,
	units,
	unitUse
} from './index.ts';
import type { BuildView, ActivityItem } from './types.ts';
import { applyPatches, makeView, run } from './fixtures.ts';

const now = new Date(2026, 2, 5, 12, 0, 0);
const H = 'harness';

function setup() {
	const v = makeView();
	const plate = v.plates.find((p) => p.number === 18)!;
	const part = v.parts.find((p) => p.slug === H)!;
	return { v, plate, part };
}
/** Log a run (as the server does: the run is applied to the view, then added to its history). */
function log(view: BuildView, input: Parameters<typeof run>[0]) {
	const r = run({ plateNumber: 18, partSlug: H, date: '2026-03-05', ...input });
	return { ...applyPatches(view, applyRun(view, r, now)), runs: [...view.runs, r] };
}
const ticks = (view: BuildView, idx: number[]) =>
	Object.fromEntries(idx.map((i) => [String(i), true]));
const ticked = (view: BuildView) =>
	Object.entries(view.state[H].comps)
		.filter(([, v]) => v)
		.map(([k]) => Number(k))
		.sort((a, b) => a - b);

describe('who can print some pieces', () => {
	it('a To print or Reprint part with two or more pieces left', () => {
		const { v } = setup();
		expect(v.parts.find((p) => p.slug === H)!.components).toHaveLength(9);
		expect(canPrintPieces(v, H)).toBe(true);
		expect(canPrintPieces(applyPatches(v, [{ slug: H, status: 'Reprint' }]), H)).toBe(true);
	});
	it('not while printing, when printed, or with fewer than two pieces left', () => {
		const { v } = setup();
		expect(canPrintPieces(applyPatches(v, [{ slug: H, status: 'Printing' }]), H)).toBe(false);
		expect(canPrintPieces(applyPatches(v, [{ slug: H, status: 'Printed' }]), H)).toBe(false);
		const nearly = applyPatches(v, [{ slug: H, comps: ticks(v, [0, 1, 2, 3, 4, 5, 6]) }]);
		expect(piecesLeft(nearly, H)).toEqual([7, 8]);
		expect(canPrintPieces(nearly, H)).toBe(true);
		const one = applyPatches(v, [{ slug: H, comps: ticks(v, [0, 1, 2, 3, 4, 5, 6, 7]) }]);
		expect(piecesLeft(one, H)).toEqual([8]);
		expect(canPrintPieces(one, H)).toBe(false);
	});
	it('not on a plate that prints more than once or one part per run', () => {
		const { v } = setup();
		const twice = {
			...v,
			plates: v.plates.map((p) => (p.number === 18 ? { ...p, runs: 2 } : p))
		};
		expect(canPrintPieces(twice, H)).toBe(false);
		const perPart = {
			...v,
			plates: v.plates.map((p) => (p.number === 18 ? { ...p, perPartRuns: true } : p))
		};
		expect(canPrintPieces(perPart, H)).toBe(false);
	});
	it('a part with no pieces never', () => {
		const { v } = setup();
		const other = v.parts.find((p) => !p.components.length)!.slug;
		expect(canPrintPieces(v, other)).toBe(false);
		expect(pieceListError(v, other, [0], 'log')).toMatch(/no separate pieces/);
	});
});

describe('the piece list a request may carry', () => {
	it('distinct whole indexes of the part, fewer than all of them', () => {
		const { v } = setup();
		expect(pieceListError(v, H, [0, 2, 4], 'start')).toBeNull();
		expect(pieceListError(v, H, [], 'start')).toMatch(/at least one/);
		expect(pieceListError(v, H, [0, 0], 'start')).toMatch(/twice/);
		expect(pieceListError(v, H, [9], 'start')).toMatch(/Unknown piece/);
		expect(pieceListError(v, H, [-1], 'start')).toMatch(/Unknown piece/);
		expect(pieceListError(v, H, [1.5], 'start')).toMatch(/Unknown piece/);
		expect(pieceListError(v, H, ['1'], 'start')).toMatch(/Unknown piece/);
		expect(pieceListError(v, H, [0, 1, 2, 3, 4, 5, 6, 7, 8], 'start')).toMatch(/not all/);
	});
	it('start refuses a ticked piece, a log does not', () => {
		const { v } = setup();
		const s = applyPatches(v, [{ slug: H, comps: ticks(v, [2]) }]);
		expect(pieceListError(s, H, [1, 2], 'start')).toMatch(/already ticked/);
		expect(pieceListError(s, H, [1, 2], 'log')).toBeNull();
	});
});

describe('starting some pieces', () => {
	it('marks the part Printing with the picked pieces, sorted', () => {
		const { v } = setup();
		const p = startPrinting(v, [H], now, null, [4, 0, 2]);
		expect(p).toHaveLength(1);
		expect(p[0]).toMatchObject({ slug: H, status: 'Printing', printingComps: [0, 2, 4] });
		const s = applyPatches(v, p);
		expect(s.state[H].status).toBe('Printing');
		// Pieces are not ticked by starting: only a Success does that.
		expect(ticked(s)).toEqual([]);
	});
	it('a typed start and estimate keep working', () => {
		const { v } = setup();
		let s = applyPatches(v, startPrinting(v, [H], now, null, [0, 1, 2]));
		s = applyPatches(s, [{ slug: H, startedAt: '2026-03-05T08:00:00.000Z', runEstSeconds: 9000 }]);
		const card = nowPrinting(s)[0];
		expect(card.startedAt).toBe('2026-03-05T08:00:00.000Z');
		expect(card.estSeconds).toBe(9000);
	});
	it('a whole-part start clears an older piece list', () => {
		const { v } = setup();
		const s = applyPatches(v, [{ slug: H, status: 'To print', printingComps: [1, 2] }]);
		const p = startPrinting(s, [H], now);
		expect(p[0].printingComps).toBeNull();
	});
});

describe('Now printing for some pieces', () => {
	it('shows the part with its pieces, and their share of grams and time', () => {
		const { v, plate } = setup();
		const typed = {
			...v,
			plates: v.plates.map((p) => (p.number === 18 ? { ...p, slicerGrams: 270 } : p))
		};
		const s = applyPatches(typed, startPrinting(typed, [H], now, null, [0, 1, 2]));
		const [c] = nowPrinting(s);
		expect(c.plate).toBe(18);
		expect(c.subset).toBe(true);
		expect(c.pieces).toEqual([
			{ slug: H, picked: ['Harness Right', 'Harness Left', 'Buckle Holder ×5'], of: 9 }
		]);
		expect(c.gramsPerRun).toBeCloseTo(270 / 3, 5);
		expect(c.gramsApprox).toBe(true);
		expect(c.slicerGrams).toBeNull();
		expect(c.estSeconds).toBe(Math.round(plate.estSeconds! / 3));
	});
	it('a whole-part print has no piece list', () => {
		const { v, plate } = setup();
		const [c] = nowPrinting(applyPatches(v, startPrinting(v, [H], now)));
		expect(c.pieces).toEqual([]);
		expect(c.subset).toBe(false);
		expect(c.estSeconds).toBe(plate.estSeconds);
	});
	it('pieces and the plate share weights as for parts (Connectors on a shared plate)', () => {
		const v = makeView();
		const plate = v.plates.find((p) => p.parts.includes('connectors') && p.parts.length > 1)!;
		const comps = v.parts.find((p) => p.slug === 'connectors')!.components;
		expect(comps.length).toBeGreaterThan(2);
		const frac = { connectors: 1 / comps.length };
		const base = subsetShare(v, plate, ['connectors']);
		const some = subsetShare(v, plate, ['connectors'], frac);
		expect(some).toBeCloseTo(base / comps.length, 8);
		expect(printGrams(v, plate, ['connectors'], frac).approx).toBe(true);
	});
});

describe('logging a piece print', () => {
	it('Success ticks exactly those pieces and the part goes back to To print', () => {
		const { v } = setup();
		let s = applyPatches(v, startPrinting(v, [H], now, null, [0, 1, 2]));
		s = applyPatches(s, [{ slug: H, startedAt: '2026-03-05T08:00:00.000Z', runEstSeconds: 9000 }]);
		s = log(s, { comps: [0, 1, 2], result: 'Success' });
		expect(s.state[H]).toMatchObject({
			status: 'To print',
			startedAt: null,
			runEstSeconds: null,
			printingComps: null,
			printedOn: null
		});
		expect(ticked(s)).toEqual([0, 1, 2]);
		expect(nowPrinting(s)).toEqual([]);
		expect(piecesLeft(s, H)).toEqual([3, 4, 5, 6, 7, 8]);
	});
	it('the run that ticks the last pieces prints the part', () => {
		const { v } = setup();
		let s = log(v, { comps: [0, 1, 2], result: 'Success' });
		s = log(s, { comps: [3, 4, 5], result: 'Success' });
		expect(s.state[H].status).toBe('To print');
		s = log(s, { comps: [6, 7, 8], result: 'Success', date: '2026-03-06' });
		expect(s.state[H]).toMatchObject({ status: 'Printed', printedOn: '2026-03-06' });
		expect(ticked(s)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
	});
	it('pieces ticked by hand count towards completing the part', () => {
		const { v } = setup();
		let s = applyPatches(v, [{ slug: H, comps: ticks(v, [0, 1, 2, 3, 4, 5]) }]);
		s = log(s, { comps: [6, 7, 8], result: 'Success' });
		expect(s.state[H].status).toBe('Printed');
	});
	it('Failed ticks nothing, clears the piece list and flags Reprint (as a failed part print does)', () => {
		const { v } = setup();
		let s = applyPatches(v, startPrinting(v, [H], now, null, [0, 1, 2]));
		s = log(s, { comps: [0, 1, 2], result: 'Failed' });
		expect(s.state[H]).toMatchObject({ status: 'Reprint', printingComps: null });
		expect(ticked(s)).toEqual([]);
		// ...and the picker is offered again for the Reprint part.
		expect(canPrintPieces(s, H)).toBe(true);
	});
	it('a Printed part is left alone', () => {
		const { v } = setup();
		const s = applyPatches(v, [{ slug: H, status: 'Printed', printedOn: '2026-03-01' }]);
		expect(
			applyRun(s, run({ plateNumber: 18, partSlug: H, comps: [0], result: 'Failed' }), now)
		).toEqual([]);
	});
	it('a piece run is not one of the plate runs: a later whole-plate run still counts as the first', () => {
		const { v } = setup();
		let s = log(v, { comps: [0, 1, 2], result: 'Success' });
		const rInfoWins = s.runs.filter((r) => !r.partSlug).length;
		expect(rInfoWins).toBe(0);
		s = log(s, { partSlug: null, comps: null, result: 'Success' });
		expect(s.state[H].status).toBe('Printed');
		expect(ticked(s)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
	});
	it('works on a part that is on no plate (a part log)', () => {
		const v = makeView();
		const orphan = v.parts.find((p) => p.slug === 'connectors')!;
		const noPlate = { ...v, plates: v.plates.filter((p) => !p.parts.includes('connectors')) };
		const r = run({ partSlug: orphan.slug, comps: [0, 1], result: 'Success' });
		const patches = applyRun(noPlate, r, now);
		expect(patches[0]).toMatchObject({ status: 'To print', printingComps: null });
		expect(patches[0].comps).toMatchObject({ '0': true, '1': true });
	});
	it('the summary names the ticks and where the part ends up', () => {
		const { v } = setup();
		const base = {
			plateNumber: 18,
			partSlug: H,
			partSlugs: null,
			comps: [0, 1, 2],
			date: '2026-03-05',
			grams: null,
			hours: null,
			printer: null,
			note: ''
		};
		expect(runOutcomeSummary(v, { ...base, result: 'Success' })).toMatch(
			/Ticks 3 of 9 pieces of Harness and Straps; it stays To print/
		);
		expect(runOutcomeSummary(v, { ...base, result: 'Failed' })).toMatch(
			/Flags Harness and Straps for reprint/
		);
		const nearly = applyPatches(v, [{ slug: H, comps: ticks(v, [3, 4, 5, 6, 7, 8]) }]);
		expect(runOutcomeSummary(nearly, { ...base, result: 'Success' })).toMatch(
			/marks Harness and Straps printed/
		);
	});
});

describe('undo', () => {
	it('a snapshot taken before the log puts the piece print back', () => {
		const { v } = setup();
		const printing = applyPatches(v, startPrinting(v, [H], now, null, [0, 1, 2]));
		const before = snapshotParts(printing, [H]);
		expect(before[0]).toMatchObject({ status: 'Printing', printingComps: [0, 1, 2] });
		const after = log(printing, { comps: [0, 1, 2], result: 'Success' });
		expect(ticked(after)).toEqual([0, 1, 2]);
		// What undoRun applies from the snapshot:
		const undone = applyPatches(after, before);
		expect(undone.state[H]).toMatchObject({ status: 'Printing', printingComps: [0, 1, 2] });
		expect(ticked(undone)).toEqual([]);
	});
});

describe('editing and deleting a piece log (recompute from the run history)', () => {
	it('deleting a Success run unticks its pieces and keeps the part To print', () => {
		const { v } = setup();
		const s = log(v, { id: 'a', comps: [0, 1, 2], result: 'Success' });
		const s2 = log(s, { id: 'b', comps: [3, 4], result: 'Success' });
		const patches = recomputeParts(
			s2,
			s2.runs.filter((r) => r.id !== 'a'),
			[H]
		);
		const after = applyPatches(s2, patches);
		expect(ticked(after)).toEqual([3, 4]);
		expect(after.state[H].status).toBe('To print');
	});
	it('deleting the run that completed the part sets it back to To print', () => {
		const { v } = setup();
		let s = log(v, { comps: [0, 1, 2, 3, 4], result: 'Success' });
		s = log(s, { comps: [5, 6, 7, 8], result: 'Success' });
		expect(s.state[H].status).toBe('Printed');
		const last = s.runs[s.runs.length - 1];
		const after = applyPatches(
			s,
			recomputeParts(
				s,
				s.runs.filter((r) => r !== last),
				[H]
			)
		);
		expect(after.state[H]).toMatchObject({ status: 'To print', printedOn: null });
		expect(ticked(after)).toEqual([0, 1, 2, 3, 4]);
	});
	it('a hand-ticked piece stays when a run is deleted', () => {
		const { v } = setup();
		let s = applyPatches(v, [{ slug: H, comps: ticks(v, [8]) }]);
		s = log(s, { comps: [0, 1], result: 'Success' });
		const after = applyPatches(s, recomputeParts(s, [], [H]));
		expect(ticked(after)).toEqual([8]);
	});
	it('changing Success to Failed unticks the pieces and flags Reprint', () => {
		const { v } = setup();
		const s = log(v, { id: 'x', comps: [0, 1, 2], result: 'Success' });
		const edited = s.runs.map((r) => (r.id === 'x' ? { ...r, result: 'Failed' as const } : r));
		const after = applyPatches(s, recomputeParts(s, edited, [H]));
		expect(after.state[H].status).toBe('Reprint');
		expect(ticked(after)).toEqual([]);
	});
	it('a piece print on the printer now survives an edit of an older log', () => {
		const { v } = setup();
		let s = log(v, { id: 'old', comps: [0, 1, 2], result: 'Success' });
		s = applyPatches(s, startPrinting(s, [H], now, null, [3, 4]));
		s = applyPatches(s, [{ slug: H, startedAt: '2026-03-05T09:00:00.000Z' }]);
		const patches = recomputeParts(
			s,
			s.runs.filter((r) => r.id !== 'old'),
			[H]
		);
		const after = applyPatches(s, patches);
		expect(after.state[H]).toMatchObject({
			status: 'Printing',
			printingComps: [3, 4],
			startedAt: '2026-03-05T09:00:00.000Z'
		});
		expect(ticked(after)).toEqual([]);
	});
	it('a job that ended before printing releases the pieces', () => {
		const { v } = setup();
		const s = applyPatches(v, startPrinting(v, [H], now, null, [0, 1]));
		const after = applyPatches(s, releaseUnstarted(s, [H]));
		expect(after.state[H]).toMatchObject({ status: 'To print', printingComps: null });
	});
});

describe('stop, hand status and hand ticks', () => {
	it('Take off printer clears the piece list', () => {
		const { v } = setup();
		const s = applyPatches(v, startPrinting(v, [H], now, null, [0, 1, 2]));
		const p = stopPrinting(s, [H]);
		expect(p[0]).toMatchObject({ status: 'To print', printingComps: null });
		expect(applyPatches(s, p).state[H].printingComps).toBeNull();
	});
	it('a status set by hand clears the piece list', () => {
		const { v } = setup();
		const s = applyPatches(v, startPrinting(v, [H], now, null, [0, 1, 2]));
		for (const to of ['To print', 'Reprint', 'Printed'] as const) {
			const p = setStatus(s, H, to, now);
			expect(p[0].printingComps).toBeNull();
		}
	});
	it('ticking a piece that is on the printer takes it off the list', () => {
		const { v } = setup();
		const s = applyPatches(v, startPrinting(v, [H], now, null, [0, 1, 2]));
		const p = setPieceTicks(s, H, ticks(s, [1]), now);
		expect(p[0]).toMatchObject({ printingComps: [0, 2] });
		expect(p[0].status).toBeUndefined();
		const s2 = applyPatches(s, p);
		expect(nowPrinting(s2)[0].pieces[0].picked).toEqual(['Harness Right', 'Buckle Holder ×5']);
	});
	it('ticking every piece on the printer ends the print: To print, or Printed when all are ticked', () => {
		const { v } = setup();
		let s = applyPatches(v, startPrinting(v, [H], now, null, [0, 1]));
		const p = setPieceTicks(s, H, ticks(s, [0, 1]), now);
		expect(p[0]).toMatchObject({ status: 'To print', printingComps: null, startedAt: null });
		const all = setPieceTicks(s, H, ticks(s, [0, 1, 2, 3, 4, 5, 6, 7, 8]), now);
		expect(all[0]).toMatchObject({ status: 'Printed', printingComps: null });
		expect(all[0].printedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		s = applyPatches(s, all);
		expect(s.state[H].status).toBe('Printed');
	});
	it('ticking or unticking with no piece print under way is only a tick', () => {
		const { v } = setup();
		const p = setPieceTicks(v, H, ticks(v, [3]), now);
		expect(p).toEqual([{ slug: H, comps: { '3': true } }]);
	});
});

describe('accounting for pieces', () => {
	it('piece share is the count ratio', () => {
		const { v } = setup();
		expect(pieceShare(v, H, [0, 1, 2])).toBeCloseTo(1 / 3, 10);
		expect(pieceShare(v, H, null)).toBe(1);
		expect(pieceShare(v, H, [])).toBe(1);
	});
	it('grams and time left count the pieces not ticked yet', () => {
		const { v, plate } = setup();
		const u = () => units(s).find((x) => x.plate === 18)!;
		let s = v;
		const full = unitLeft(s, u());
		expect(full).toBeGreaterThan(0);
		expect(timeStats(s).leftSec).toBe(
			timeStats(s).leftSec // untouched baseline
		);
		const leftAll = timeStats(s).leftSec;
		s = applyPatches(s, [{ slug: H, comps: ticks(s, [0, 1, 2]) }]);
		expect(leftShare(s, [H])).toBeCloseTo(6 / 9, 10);
		expect(unitLeft(s, u())).toBeCloseTo((full * 6) / 9, 5);
		expect(timeStats(s).leftSec).toBeCloseTo(leftAll - plate.estSeconds! / 3, 3);
		// the totals do not move
		expect(timeStats(s).totalSec).toBe(timeStats(v).totalSec);
	});
	it('every piece ticked without the part marked Printed counts as untouched (a checklist, not a print)', () => {
		const { v } = setup();
		const s = applyPatches(v, [{ slug: H, comps: ticks(v, [0, 1, 2, 3, 4, 5, 6, 7, 8]) }]);
		expect(leftShare(s, [H])).toBe(1);
	});
	it('filament need follows the pieces left; kept and lost stay consistent', () => {
		const { v } = setup();
		const role = v.parts.find((p) => p.slug === H)!.role;
		const need = (x: BuildView) => filamentStats(x).find((f) => f.role === role)!.need;
		const before = need(v);
		let s = log(v, { comps: [0, 1, 2], result: 'Success', grams: 90 });
		// the role has other parts: only the harness's third (264 g BOM, 3 of 9 pieces) leaves the need
		expect(before - need(s)).toBeCloseTo(264 / 3, 5);
		s = log(s, { comps: [3, 4, 5], result: 'Failed', grams: 40 });
		const f = filamentStats(s).find((x) => x.role === role)!;
		expect(f.keptG).toBe(90);
		expect(f.lostG).toBe(40);
		expect(f.used).toBe(130);
		// finish the part: three more pieces of 90 g and the unit is done; its estimate is not added
		// again for the pieces the logs already stand for (3 + 3 of 9 pieces measured).
		s = log(s, { comps: [3, 4, 5], result: 'Success', grams: 90 });
		s = log(s, { comps: [6, 7, 8], result: 'Success', grams: 90 });
		expect(s.state[H].status).toBe('Printed');
		const unit = units(s).find((x) => x.plate === 18)!;
		const use = unitUse(s, unit);
		expect(use.kept).toBeCloseTo(270, 5);
		expect(use.lost).toBe(40);
		// a part finished with only a third measured keeps the estimate for the rest
		const t = log(log(v, { comps: [0, 1, 2], result: 'Success', grams: 90 }), {
			comps: [3, 4, 5, 6, 7, 8],
			result: 'Success'
		});
		const tu = unitUse(
			t,
			units(t).find((x) => x.plate === 18)!
		);
		expect(tu.kept).toBeCloseTo(90 + 264 * (1 - 1 / 3), 5);
	});
	it('pace ignores piece runs, even with hours and a plate time', () => {
		const { v, plate } = setup();
		const hrs = plate.estSeconds! / 3600;
		const pieces = Array.from({ length: 4 }, (_, i) => ({ comps: [i], hours: hrs * 0.8 }));
		let s = v;
		for (const p of pieces) s = log(s, { ...p, result: 'Success' });
		expect(paceOf(s)).toBeNull();
		// the same hours as a whole-plate run are a sample
		const whole = run({
			plateNumber: 18,
			result: 'Success',
			hours: Math.round(hrs * 8) / 10 + 0.05
		});
		expect(paceOf({ ...v, runs: [whole, whole, whole] })).not.toBeNull();
	});
});

describe('activity sentences', () => {
	const view = (() => {
		const { v } = setup();
		return v;
	})();
	const act = (kind: string, payload: Record<string, unknown>): ActivityItem => ({
		id: 'a',
		userId: 'u',
		userName: 'Sam',
		kind,
		payload,
		at: '2026-03-05T12:00:00.000Z'
	});
	it('printing.start names the pieces', () => {
		expect(describeActivity(act('printing.start', { slugs: [H], comps: [0, 1, 2] }), view)).toBe(
			'Sam put 3 pieces of Harness and Straps on the printer'
		);
		expect(
			describeActivity(act('printing.start', { slugs: [H], comps: [4], printer: 'Shop' }), view)
		).toBe('Sam put 1 piece of Harness and Straps on Shop');
		expect(describeActivity(act('printing.start', { slugs: [H] }), view)).toBe(
			'Sam put Harness and Straps on the printer'
		);
	});
	it('run rows name the pieces and keep the plate link', () => {
		const p = { plateNumber: 18, partSlug: H, comps: [0, 1, 2], result: 'Success', grams: 88 };
		expect(describeActivity(act('run.add', p), view)).toBe(
			'Sam logged a successful print of 3 pieces of Harness and Straps (plate 18) (88 g)'
		);
		expect(describeActivity(act('run.undo', p), view)).toBe(
			'Sam undid a successful print of 3 pieces of Harness and Straps (plate 18)'
		);
		expect(describeActivity(act('run.delete', { ...p, result: 'Failed' }), view)).toBe(
			'Sam deleted a failed print of 3 pieces of Harness and Straps (plate 18) from the log'
		);
	});
	it('ignores a comps list that is not whole numbers', () => {
		expect(describeActivity(act('printing.start', { slugs: [H], comps: ['x', 1.5] }), view)).toBe(
			'Sam put Harness and Straps on the printer'
		);
	});
});
