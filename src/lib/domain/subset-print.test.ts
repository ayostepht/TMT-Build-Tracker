/**
 * Printing and logging some parts of a plate on their own (the Print tab's "Select parts"): the
 * Now printing card shows their share, a subset run marks exactly those parts, and the rest of the
 * plate stays trackable, one print after the other or both at once.
 */
import { describe, expect, it } from 'vitest';
import {
	applyRun,
	nowPrinting,
	paceOf,
	printGrams,
	plateGrams,
	runTargets,
	splitPartial,
	startPrinting,
	subsetShare,
	unitUse,
	units,
	weightShare
} from './index.ts';
import { applyPatches, makeView, run } from './fixtures.ts';

const now = new Date(2026, 2, 5, 12, 0, 0);
const later = new Date(2026, 2, 5, 18, 0, 0);

function setup() {
	const v = makeView();
	const plate = v.plates.find((p) => p.number === 10)!; // seat-back-top 113 g + seat-back-bottom 135 g
	const [top, bottom] = plate.parts;
	return { v, plate, top, bottom };
}
function log(view: ReturnType<typeof makeView>, input: Parameters<typeof run>[0]) {
	const r = run(input);
	return { ...applyPatches(view, applyRun(view, r, now)), runs: [...view.runs, r] };
}

describe('share of a plate printed in parts', () => {
	it('is the parts weight share, 1 for the whole plate and for perPartRuns plates', () => {
		const { v, plate, top, bottom } = setup();
		expect(subsetShare(v, plate, [top])).toBeCloseTo(113 / 248, 5);
		expect(subsetShare(v, plate, [bottom])).toBeCloseTo(135 / 248, 5);
		expect(subsetShare(v, plate, [top, bottom])).toBe(1);
		expect(subsetShare(v, plate, [])).toBe(1);
		const rims = v.plates.find((p) => p.perPartRuns)!;
		expect(subsetShare(v, rims, [rims.parts[0]])).toBe(1);
		expect(weightShare(v, plate.parts, [top])).toBeCloseTo(subsetShare(v, plate, [top]), 10);
	});
	it('scales the plate grams, a typed slicer total included', () => {
		const { v, plate, top } = setup();
		expect(printGrams(v, plate, [top]).perRun).toBeCloseTo(113, 5);
		const typed = {
			...v,
			plates: v.plates.map((p) => (p === plate ? { ...p, slicerGrams: 300 } : p))
		};
		const info = printGrams(
			typed,
			typed.plates.find((p) => p.number === 10)!,
			[top]
		);
		expect(info.perRun).toBeCloseTo(300 * (113 / 248), 5);
		expect(info.source).toBe(
			plateGrams(
				typed,
				typed.plates.find((p) => p.number === 10)!
			).source
		);
	});
});

describe('Now printing for some parts of a plate', () => {
	it('lists those parts with their share of grams and time, and does not offer the plate total', () => {
		const { v, plate, top } = setup();
		const typed = {
			...v,
			plates: v.plates.map((p) => (p === plate ? { ...p, slicerGrams: 300 } : p))
		};
		const cards = nowPrinting(applyPatches(typed, startPrinting(typed, [top], now)));
		expect(cards).toHaveLength(1);
		const c = cards[0];
		expect(c.plate).toBe(10);
		expect(c.parts.map((p) => p.slug)).toEqual([top]);
		expect(c.subset).toBe(true);
		expect(c.gramsPerRun).toBeCloseTo(300 * (113 / 248), 5);
		expect(c.slicerGrams).toBeNull();
		expect(c.estSeconds).toBe(Math.round(plate.estSeconds! * (113 / 248)));
	});
	it('keeps a typed run time (setEstimate) as it is', () => {
		const { v, top } = setup();
		let s = applyPatches(v, startPrinting(v, [top], now));
		s = applyPatches(s, [{ slug: top, runEstSeconds: 7200 }]);
		expect(nowPrinting(s)[0].estSeconds).toBe(7200);
	});
	it('shows the whole plate when every part is on the printer', () => {
		const { v, plate, top, bottom } = setup();
		const c = nowPrinting(applyPatches(v, startPrinting(v, [top, bottom], now)))[0];
		expect(c.subset).toBe(false);
		expect(c.gramsPerRun).toBeCloseTo(plateGrams(v, plate).perRun, 5);
		expect(c.estSeconds).toBe(plate.estSeconds);
	});
	it('picked parts from two plates are two cards', () => {
		const { v, top } = setup();
		const other = v.plates.find((p) => p.number === 14)!.parts[0];
		const cards = nowPrinting(applyPatches(v, startPrinting(v, [top, other], now)));
		expect(cards.map((c) => c.plate)).toEqual([10, 14]);
		expect(cards.every((c) => c.subset)).toBe(true);
	});
});

describe('picked parts, then the rest of the plate', () => {
	it('sequential: log the picked parts, then start and log the rest', () => {
		const { v, top, bottom } = setup();
		let s = applyPatches(v, startPrinting(v, [top], now));
		// The picked part is logged as a subset run: exactly it is Printed.
		s = log(s, {
			plateNumber: 10,
			partSlugs: [top],
			result: 'Success',
			date: '2026-03-05',
			grams: 112
		});
		expect(s.state[top].status).toBe('Printed');
		expect(s.state[top].startedAt).toBeNull();
		expect(s.state[bottom].status).toBe('To print');
		expect(nowPrinting(s)).toEqual([]);
		// Now the rest of the plate (what PlateControl starts: the parts still idle).
		s = applyPatches(s, startPrinting(s, [bottom], later));
		const card = nowPrinting(s)[0];
		expect(card.parts.map((p) => p.slug)).toEqual([bottom]);
		expect(card.subset).toBe(true);
		expect(card.gramsPerRun).toBeCloseTo(135, 5);
		s = log(s, {
			plateNumber: 10,
			partSlugs: [bottom],
			result: 'Success',
			date: '2026-03-05',
			grams: 136
		});
		expect(s.state[bottom].status).toBe('Printed');
		// Both runs are in the numbers once: 112 + 136 g kept, nothing doubled from the estimate.
		const u = units(s).find((x) => x.plate === 10)!;
		expect(unitUse(s, u)).toEqual({ kept: 248, lost: 0 });
	});
	it('both at once: one card for the plate, and the pick can still be logged on its own', () => {
		const { v, top, bottom } = setup();
		let s = applyPatches(v, startPrinting(v, [top], now));
		s = applyPatches(s, startPrinting(s, [bottom], later)); // idle rest only; top stays as it is
		expect(s.state[top].startedAt).toBe(now.toISOString());
		expect(s.state[bottom].startedAt).toBe(later.toISOString());
		const cards = nowPrinting(s);
		expect(cards).toHaveLength(1);
		expect(cards[0].subset).toBe(false);
		expect(cards[0].startedAt).toBe(now.toISOString());
		// The picked part finished first: logging only it leaves the rest printing.
		s = log(s, { plateNumber: 10, partSlugs: [top], result: 'Success', date: '2026-03-05' });
		expect(s.state[top].status).toBe('Printed');
		expect(s.state[bottom].status).toBe('Printing');
		expect(s.state[bottom].startedAt).toBe(later.toISOString());
		expect(nowPrinting(s)[0].parts.map((p) => p.slug)).toEqual([bottom]);
	});
	it('a failed pick flags only those parts for reprint', () => {
		const { v, top, bottom } = setup();
		let s = applyPatches(v, startPrinting(v, [top], now));
		s = log(s, { plateNumber: 10, partSlugs: [top], result: 'Failed', grams: 20 });
		expect(s.state[top].status).toBe('Reprint');
		expect(s.state[bottom].status).toBe('To print');
		expect(
			unitUse(
				s,
				units(s).find((x) => x.plate === 10)!
			)
		).toEqual({ kept: 0, lost: 20 });
	});
});

describe('Partial over a picked selection', () => {
	it('splits the selection only, with its own share of hours', () => {
		const v = makeView();
		const plate = v.plates.find((p) => p.number === 14)!;
		const [mount, brace, bolt] = plate.parts;
		const base = run({ plateNumber: 14, partSlugs: [mount, brace], result: 'Partial', hours: 10 });
		expect(runTargets(v, base)).toEqual([mount, brace]);
		const halves = splitPartial(v, base, { keptSlugs: [mount], keptGrams: 200, lostGrams: 50 })!;
		expect(halves.keptSlugs).toEqual([mount]);
		expect(halves.lostSlugs).toEqual([brace]);
		expect(halves.share).toBeCloseTo(215 / (215 + 145), 5);
		expect(halves.kept.hours! + halves.lost.hours!).toBeCloseTo(10, 5);
		const patches = [...applyRun(v, halves.kept, now), ...applyRun(v, halves.lost, now)];
		expect(patches.find((p) => p.slug === mount)?.status).toBe('Printed');
		expect(patches.find((p) => p.slug === brace)?.status).toBe('Reprint');
		expect(patches.some((p) => p.slug === bolt)).toBe(false);
	});
});

describe('pace ignores runs of some parts', () => {
	it('a subset run adds nothing to the pace', () => {
		const { v, top } = setup();
		const s = log(v, { plateNumber: 10, partSlugs: [top], result: 'Success', hours: 5 });
		expect(paceOf(s)).toBeNull();
	});
});

describe('picked parts without a weight', () => {
	const noWeight = (v: ReturnType<typeof makeView>, slugs: string[]) => {
		const strip = <T extends { slug: string; bomGrams: number | null }>(p: T): T =>
			slugs.includes(p.slug) ? { ...p, bomGrams: null } : p;
		return { ...v, parts: v.parts.map(strip), allParts: v.allParts.map(strip) };
	};
	it('all picked parts weightless: time by part count, grams unknown (never 0 g or a guess)', () => {
		const { v, plate, top, bottom } = setup();
		const w = noWeight(v, [top]);
		const withTyped = {
			...w,
			plates: w.plates.map((p) => (p.number === 10 ? { ...p, slicerGrams: 300 } : p))
		};
		const pl = withTyped.plates.find((p) => p.number === 10)!;
		const info = printGrams(withTyped, pl, [top]);
		expect(info.perRun).toBe(0);
		expect(info.source).toBe('none');
		expect(info.unknown).toEqual([top]);
		const card = nowPrinting(applyPatches(withTyped, startPrinting(withTyped, [top], now)))[0];
		expect(card.gramsPerRun).toBeNull();
		expect(card.gramsUnknown).toEqual([top]);
		expect(card.estSeconds).toBe(Math.round(plate.estSeconds! * subsetShare(withTyped, pl, [top])));
		expect(card.estSeconds).toBeGreaterThan(0);
		expect(bottom).toBeTruthy();
	});
	it('some picked parts weightless: scaled grams, flagged approximate, parts listed', () => {
		const v = makeView();
		const plate = v.plates.find((p) => p.number === 14)!;
		const [mount, , bolt] = plate.parts; // bolt has no weight
		const info = printGrams(v, plate, [mount, bolt]);
		expect(info.perRun).toBeGreaterThan(0);
		expect(info.unknown).toEqual([bolt]);
		expect(info.approx).toBe(true);
		const card = nowPrinting(applyPatches(v, startPrinting(v, [mount, bolt], now)))[0];
		expect(card.gramsUnknown).toEqual([bolt]);
		expect(card.gramsPerRun).toBeGreaterThan(0);
	});
	it('a plate with no weight at all: time by part count, grams unknown', () => {
		const { v, plate, top, bottom } = setup();
		const w = noWeight(v, [top, bottom]);
		const pl = w.plates.find((p) => p.number === 10)!;
		expect(subsetShare(w, pl, [top])).toBeCloseTo(0.5, 5);
		const info = printGrams(w, pl, [top]);
		expect(info.perRun).toBe(0);
		expect(info.unknown).toEqual([top]);
		const card = nowPrinting(applyPatches(w, startPrinting(w, [top], now)))[0];
		expect(card.gramsPerRun).toBeNull();
		expect(card.estSeconds).toBe(Math.round(plate.estSeconds! * 0.5));
	});
});
