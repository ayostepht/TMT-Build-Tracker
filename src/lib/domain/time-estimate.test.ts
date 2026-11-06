import { describe, expect, it } from 'vitest';
import { timeLeftText, timeStats } from './accounting.ts';
import { makeView } from './fixtures.ts';
import { buildTimeModel, estimateArranged } from './time-estimate.ts';
import { tmtTemplate } from '../server/seed/tmt.ts';

const part = (slug: string, bomGrams: number | null, qty: number | null = 1) => ({
	slug,
	bomGrams,
	qty
});

describe('buildTimeModel', () => {
	it('splits a plate time over its parts by BOM grams', () => {
		const m = buildTimeModel(
			[part('a', 100), part('b', 300)],
			[{ number: 1, estSeconds: 4000, runs: 1, parts: ['a', 'b'] }]
		);
		expect(m.byPart.get('a')).toEqual({ totalSec: 1000, rough: false });
		expect(m.byPart.get('b')).toEqual({ totalSec: 3000, rough: false });
	});

	it('gives parts without grams the weight of the average part', () => {
		const m = buildTimeModel(
			[part('a', 100), part('b', 300), part('c', null)],
			[{ number: 1, estSeconds: 1000, runs: 1, parts: ['a', 'b', 'c'] }]
		);
		// weights 100, 300, 200
		expect(m.byPart.get('c')!.totalSec).toBeCloseTo(1000 / 3);
		const sum = [...m.byPart.values()].reduce((a, p) => a + p.totalSec, 0);
		expect(sum).toBeCloseTo(1000);
	});

	it('multiplies by runs, and perPartRuns gives each part the plate time per run', () => {
		const m = buildTimeModel(
			[part('t', 400, 4), part('r1', 50), part('r2', 50)],
			[
				{ number: 1, estSeconds: 1000, runs: 2, parts: ['t'] },
				{ number: 2, estSeconds: 500, runs: 2, perPartRuns: true, parts: ['r1', 'r2'] }
			]
		);
		expect(m.byPart.get('t')!.totalSec).toBe(2000);
		expect(m.byPart.get('r1')!.totalSec).toBe(1000);
		expect(m.byPart.get('r2')!.totalSec).toBe(1000);
	});

	it('estimates parts on no plate from the kit-wide seconds per gram, marked rough', () => {
		const m = buildTimeModel(
			[part('a', 100), part('b', 300), part('v', 200)],
			[{ number: 1, estSeconds: 4000, runs: 1, parts: ['a', 'b'] }]
		);
		expect(m.secPerGram).toBe(10);
		expect(m.byPart.get('v')).toEqual({ totalSec: 2000, rough: true });
	});

	it('gives nothing to a variant part without grams', () => {
		const m = buildTimeModel(
			[part('a', 100), part('v', null)],
			[{ number: 1, estSeconds: 1000, runs: 1, parts: ['a'] }]
		);
		expect(m.byPart.has('v')).toBe(false);
	});

	it('the real X/P/A layout reproduces MakeGood total', () => {
		const m = buildTimeModel(tmtTemplate.parts, tmtTemplate.plates);
		const total = tmtTemplate.plates.reduce(
			(a, p) => a + (p.estSeconds ?? 0) * p.runs * (p.perPartRuns ? p.parts.length : 1),
			0
		);
		const model = [...m.byPart.values()]
			.filter((p) => !p.rough)
			.reduce((a, p) => a + p.totalSec, 0);
		expect(model).toBeCloseTo(total, 0);
	});
});

describe('estimateArranged', () => {
	const m = buildTimeModel(
		[part('a', 100), part('b', 300), part('v', 200)],
		[{ number: 1, estSeconds: 4000, runs: 1, parts: ['a', 'b'] }]
	);
	it('sums the items of each plate, spreading a part over its copies', () => {
		const e = estimateArranged(m, [
			{ number: 1, runs: 1, items: ['a', 'b', 'v'] },
			{ number: 2, runs: 1, items: ['b', 'b'] }
		]);
		// b: 3000 over 3 items -> 1000 each
		expect(e.get(1)).toEqual({ estSeconds: 1000 + 1000 + 2000, rough: true });
		expect(e.get(2)).toEqual({ estSeconds: 2000, rough: false });
	});
	it('counts the runs of a plate when spreading', () => {
		const e = estimateArranged(m, [{ number: 1, runs: 2, items: ['b'] }]);
		expect(e.get(1)!.estSeconds).toBe(1500);
	});
	it('is null when no part of the plate has a time', () => {
		expect(estimateArranged(m, [{ number: 1, runs: 1, items: ['zzz'] }]).get(1)).toEqual({
			estSeconds: null,
			rough: false
		});
	});
});

describe('timeStats and its header text', () => {
	it('shows a dash and a hint, never ~0.0 h, when no plate has a time', () => {
		const v = makeView();
		v.plates = v.plates.map((p) => ({ ...p, estSeconds: null }));
		const t = timeStats(v);
		expect(t.known).toBe(false);
		expect(timeLeftText(t)).toEqual({
			text: '—',
			hint: 'no time estimate yet',
			kind: 'unknown'
		});
	});
	it('labels our own estimate as an estimate', () => {
		const v = makeView();
		v.plates = v.plates.map((p) => ({ ...p, estSeconds: 3600, estSource: 'estimate' as const }));
		const t = timeStats(v);
		const text = timeLeftText(t);
		expect(t.estimated).toBe(true);
		expect(text.kind).toBe('estimate');
		expect(text.text).toMatch(/^~/);
		expect(text.hint).toMatch(/estimate/);
	});
	it('does not call slicer or profile times an estimate', () => {
		const v = makeView();
		v.plates = v.plates.map((p) => ({ ...p, estSource: 'slicer' as const }));
		const text = timeLeftText(timeStats(v));
		expect(text.kind).toBe('known');
		expect(text.hint).toBeNull();
	});
	it('says 0 h only when nothing is left', () => {
		const v = makeView();
		v.plates = v.plates.map((p) => ({ ...p, estSeconds: null }));
		for (const s of Object.values(v.state)) s.status = 'Printed';
		expect(timeLeftText(timeStats(v)).kind).toBe('done');
	});
});

describe('variant groups', () => {
	it('estimates a gramless variant option from the other option, marked rough', () => {
		const m = buildTimeModel(
			[part('one', 100), part('two-a', null), part('two-b', null)],
			[{ number: 1, estSeconds: 3000, runs: 1, parts: ['one'] }],
			[{ options: [{ parts: ['one'] }, { parts: ['two-a', 'two-b'] }] }]
		);
		expect(m.byPart.get('two-a')).toEqual({ totalSec: 1500, rough: true });
		expect(m.byPart.get('two-b')).toEqual({ totalSec: 1500, rough: true });
	});
});
