import { describe, expect, it } from 'vitest';
import { keepLoggedTicks, loggedPieces, pieceTickError, tickLoggedPieces } from './actions.ts';
import type { BuildView, PartState, PrintRun } from './types.ts';

const run = (over: Partial<PrintRun>): PrintRun =>
	({
		id: 'r',
		plateNumber: 1,
		partSlug: 'h',
		partSlugs: null,
		comps: [0, 2],
		date: '2026-01-01',
		result: 'Success',
		...over
	}) as PrintRun;
const parts = [{ slug: 'h', components: [{}, {}, {}, {}] }] as unknown as BuildView['parts'];
const state = { h: { slug: 'h', comps: { '1': true } } } as unknown as Record<string, PartState>;

describe('pieces a Success log covers', () => {
	it('only Success runs of the part with comps count, in range', () => {
		const runs = [
			run({ id: 'a', comps: [2, 0, 9] }),
			run({ id: 'b', result: 'Failed', comps: [1] }),
			run({ id: 'c', partSlug: 'x', comps: [3] }),
			run({ id: 'd', comps: null })
		];
		expect(loggedPieces({ runs, parts }, 'h')).toEqual([0, 2]);
	});
	it('ticks them on top of the stored ticks, and returns the same object when nothing is missing', () => {
		const runs = [run({})];
		const out = tickLoggedPieces({ runs, parts }, state);
		expect(out.h.comps).toEqual({ '0': true, '1': true, '2': true });
		expect(state.h.comps).toEqual({ '1': true });
		expect(tickLoggedPieces({ runs, parts }, out)).toBe(out);
		expect(tickLoggedPieces({ runs: [], parts }, state)).toBe(state);
	});
	it('refuses an explicit untick of a logged piece only; a missing key is ticked again', () => {
		const v = { runs: [run({})], parts };
		expect(pieceTickError(v, 'h', { '0': false })).toMatch(/Piece 1 is logged/);
		expect(pieceTickError(v, 'h', { '1': false, '0': true })).toBeNull();
		expect(pieceTickError(v, 'h', {})).toBeNull();
		expect(keepLoggedTicks(v, 'h', { '1': true })).toEqual({ '0': true, '1': true, '2': true });
	});
});
