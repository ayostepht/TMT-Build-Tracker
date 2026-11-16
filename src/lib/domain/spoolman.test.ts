import { describe, expect, it } from 'vitest';
import { filamentStats, linkedRunGrams } from './accounting.ts';
import { makeView, run } from './fixtures.ts';
import {
	dayOf,
	haveGramsOf,
	isDeductibleRun,
	isPreLinkRun,
	readSpoolmanStock,
	runCountsForDeduction
} from './spoolman.ts';
import type { BuildView, RoleSpoolman } from './types.ts';

const LINK = Date.parse('2026-03-10T12:00:00Z');

describe('pre-link rule', () => {
	it('is never pre-link without a link time', () => {
		expect(isPreLinkRun({ date: '2000-01-01', createdAt: 1 }, null)).toBe(false);
		expect(isPreLinkRun({ date: '2000-01-01' }, undefined)).toBe(false);
	});
	it('a run created before the link is pre-link, one created after is not', () => {
		expect(isPreLinkRun({ date: '2026-03-10', createdAt: LINK - 1 }, LINK)).toBe(true);
		expect(isPreLinkRun({ date: '2026-03-10', createdAt: LINK + 1 }, LINK)).toBe(false);
	});
	it('a run dated before the link day is pre-link even when logged after it', () => {
		expect(dayOf(LINK)).toBe('2026-03-10');
		expect(isPreLinkRun({ date: '2026-03-09', createdAt: LINK + 5000 }, LINK)).toBe(true);
	});
	it('without a creation time, the link day counts as after the link', () => {
		expect(isPreLinkRun({ date: '2026-03-10' }, LINK)).toBe(false);
		expect(isPreLinkRun({ date: '2026-03-09' }, LINK)).toBe(true);
	});
	it('deducts only runs with grams, not old Partial rows, and not pre-link ones (also on edit)', () => {
		const post = { date: '2026-03-11', result: 'Success' as const, grams: 10 };
		expect(runCountsForDeduction(post, LINK)).toBe(true);
		expect(runCountsForDeduction({ ...post, grams: null }, LINK)).toBe(false);
		expect(runCountsForDeduction({ ...post, result: 'Partial' }, LINK)).toBe(false);
		expect(isDeductibleRun({ result: 'Failed', grams: 3 })).toBe(true);
		// an edit that changes grams or result of a pre-link run still deducts nothing
		expect(runCountsForDeduction({ ...post, date: '2026-03-01', grams: 99 }, LINK)).toBe(false);
		expect(runCountsForDeduction({ ...post, createdAt: LINK - 10 }, LINK)).toBe(false);
	});
});

describe('cached stock', () => {
	const data = {
		weight: 1000,
		spools: [
			{ id: 1, remaining_weight: 400, initial_weight: 1000 },
			{ id: 2, remaining_weight: 900, initial_weight: 1000 },
			{ id: 3, remaining_weight: 50, archived: true }
		]
	};
	it('sums the open spools, or reads the linked one', () => {
		const row = { fetchedAt: 5, error: null };
		expect(readSpoolmanStock(data, row, null)).toMatchObject({
			remainingG: 1300,
			initialG: 2000,
			stale: false
		});
		expect(readSpoolmanStock(data, row, 3).remainingG).toBe(50);
		expect(readSpoolmanStock(data, row, 99).remainingG).toBeNull();
	});
	it('flags an error as stale and survives junk', () => {
		expect(readSpoolmanStock(data, { fetchedAt: 5, error: 'down' }, null).stale).toBe(true);
		expect(readSpoolmanStock('x', { fetchedAt: 5, error: null }, null).remainingG).toBeNull();
		expect(
			readSpoolmanStock({ spools: 3 }, { fetchedAt: 5, error: null }, null).remainingG
		).toBeNull();
	});
});

const sm = (over: Partial<RoleSpoolman> = {}): RoleSpoolman => ({
	filamentId: 7,
	spoolId: null,
	linkedAt: LINK,
	keptBy: 'app',
	sharedWith: 0,
	stock: { remainingG: 600, initialG: 1000, fetchedAt: 1, stale: false, error: null },
	deductedG: 0,
	prelinkDeductedG: 0,
	preLinkLoggedG: 0,
	...over
});

describe('haveGramsOf', () => {
	const base = { appStockG: 2000, usedG: 500, postLinkUsedG: 100 };
	it('unlinked: the app stock minus everything logged', () => {
		expect(haveGramsOf(base)).toEqual({ haveGrams: 2000, usedGrams: 500, source: 'app' });
		// a spool-only legacy link is not a filament link
		expect(haveGramsOf({ ...base, spoolman: sm({ filamentId: null }) }).source).toBe('app');
	});
	it('linked, kept by other: Spoolman remaining, nothing subtracted', () => {
		expect(haveGramsOf({ ...base, spoolman: sm({ keptBy: 'other' }) })).toEqual({
			haveGrams: 600,
			usedGrams: 0,
			source: 'spoolman'
		});
	});
	it('linked, kept by app: pre-link grams are never subtracted, only undelivered post-link ones', () => {
		expect(haveGramsOf({ ...base, spoolman: sm({ deductedG: 100 }) }).usedGrams).toBe(0);
		expect(haveGramsOf({ ...base, spoolman: sm({ deductedG: 60 }) }).usedGrams).toBe(40);
		// the one-off pre-link deduction is in Spoolman's weight already and changes nothing here
		expect(
			haveGramsOf({ ...base, spoolman: sm({ deductedG: 100, prelinkDeductedG: 400 }) })
		).toEqual({ haveGrams: 600, usedGrams: 0, source: 'spoolman' });
	});
	it('linked but never fetched is unknown', () => {
		expect(haveGramsOf({ ...base, spoolman: sm({ stock: null }) }).source).toBe('unknown');
	});
});

describe('filamentStats while linked', () => {
	function build(spoolman?: RoleSpoolman): BuildView {
		const v = makeView();
		const plate = v.plates.find((p) => !p.perPartRuns && p.parts.length)!;
		const role = v.parts.find((p) => p.slug === plate.parts[0])!.role;
		v.runs = [
			run({ plateNumber: plate.number, date: '2026-03-01', grams: 100 }),
			run({ plateNumber: plate.number, date: '2026-03-12', grams: 50 })
		];
		v.filaments = v.filaments.map((f) => (f.key === role ? { ...f, spoolman } : f));
		(v as BuildView & { _role: string })._role = role;
		return v;
	}
	const role = (v: BuildView) => (v as BuildView & { _role: string })._role;
	const stat = (v: BuildView) => filamentStats(v).find((s) => s.role === role(v))!;

	it('splits logged grams around the link', () => {
		const v = build(sm());
		expect(linkedRunGrams(v, role(v), LINK)).toEqual({ preG: 100, postG: 50 });
		expect(linkedRunGrams(v, role(v), null)).toEqual({ preG: 0, postG: 150 });
	});
	it('unlinked stats are unchanged: spare = stock - used - need', () => {
		const s = stat(build());
		expect(s.haveSource).toBe('app');
		expect(s.spareG).toBeCloseTo(s.haveGrams - s.used - s.need);
		expect(s.usedForSpare).toBe(s.used);
	});
	it('kept by app: spare is Spoolman remaining less need less undelivered post-link grams', () => {
		const s = stat(build(sm({ deductedG: 50 })));
		expect(s.haveSource).toBe('spoolman');
		expect(s.haveGrams).toBe(600);
		expect(s.spareG).toBeCloseTo(600 - s.need);
		const pending = stat(build(sm({ deductedG: 0 })));
		expect(pending.spareG).toBeCloseTo(600 - 50 - pending.need);
	});
	it('kept by other: pre- and post-link prints are not subtracted again', () => {
		const s = stat(build(sm({ keptBy: 'other' })));
		expect(s.spareG).toBeCloseTo(600 - s.need);
	});
	it('does not call a linked slot short when Spoolman was never fetched', () => {
		const s = stat(build(sm({ stock: null })));
		expect(s.haveSource).toBe('unknown');
		expect(s.short).toBe(false);
	});
});
