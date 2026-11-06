import { describe, expect, it } from 'vitest';
import { buildTimeModel, estimateArranged, type LearnedTime } from './time-estimate.ts';
import { timeLeftText, timeStats } from './accounting.ts';
import { makeView } from './fixtures.ts';

const part = (slug: string, bomGrams: number | null, qty: number | null = 1) => ({
	slug,
	bomGrams,
	qty
});
const layout = [{ number: 1, estSeconds: 4000, runs: 1, parts: ['a', 'b'] }];
const learned = (o: Record<string, LearnedTime>) => new Map(Object.entries(o));

describe('time model precedence: learned > MakeGood profile > estimate', () => {
	it('a learned part replaces the profile time, qty times the time per copy', () => {
		const m = buildTimeModel(
			[part('a', 100), part('b', 300, 2), part('v', 200)],
			layout,
			[],
			learned({ b: { secondsPerCopy: 500, gramsByRole: { primary: 20, accent: 5 } } })
		);
		expect(m.byPart.get('a')).toEqual({ totalSec: 1000, rough: false }); // profile
		expect(m.byPart.get('b')).toEqual({
			totalSec: 1000,
			rough: false,
			learned: true,
			gramsByRole: { primary: 40, accent: 10 }
		});
		expect(m.byPart.get('v')!.rough).toBe(true); // estimate
	});

	it('learned data does not change the kit-wide seconds per gram', () => {
		const base = buildTimeModel([part('a', 100), part('b', 300)], layout);
		const l = buildTimeModel(
			[part('a', 100), part('b', 300)],
			layout,
			[],
			learned({
				a: { secondsPerCopy: 9, gramsByRole: {} }
			})
		);
		expect(l.secPerGram).toBe(base.secPerGram);
	});

	it('ignores a profile without a time', () => {
		const m = buildTimeModel(
			[part('a', 100), part('b', 300)],
			layout,
			[],
			learned({
				a: { secondsPerCopy: null, gramsByRole: { primary: 3 } }
			})
		);
		expect(m.byPart.get('a')!.learned).toBeUndefined();
	});

	it('arranged plates are learned only when every timed item is, and carry grams per run by role', () => {
		const m = buildTimeModel(
			[part('a', 100), part('b', 300)],
			layout,
			[],
			learned({
				a: { secondsPerCopy: 600, gramsByRole: { primary: 30 } },
				b: { secondsPerCopy: 400, gramsByRole: { accent: 20 } }
			})
		);
		const out = estimateArranged(m, [
			{ number: 1, runs: 1, items: ['a', 'b'] },
			{ number: 2, runs: 1, items: ['a'] }
		]);
		// 'a' is on two plates: its 600 s spread over both
		expect(out.get(1)).toEqual({
			estSeconds: 700,
			rough: false,
			learned: true,
			gramsByRole: { primary: 15, accent: 20 }
		});
		expect(out.get(2)!.estSeconds).toBe(300);

		const mixed = buildTimeModel(
			[part('a', 100), part('b', 300)],
			layout,
			[],
			learned({
				a: { secondsPerCopy: 600, gramsByRole: { primary: 30 } }
			})
		);
		const o2 = estimateArranged(mixed, [{ number: 1, runs: 1, items: ['a', 'b'] }]).get(1)!;
		expect(o2.learned).toBeUndefined();
		expect(o2.gramsByRole).toBeUndefined();
	});
});

describe('totals label', () => {
	it('says "from your slice" when plate times are learned', () => {
		const v = makeView();
		v.plates = v.plates.slice(0, 2).map((p) => ({ ...p, estSeconds: 3600, estSource: 'learned' }));
		const t = timeStats(v);
		expect(t.learned).toBe(true);
		expect(t.estimated).toBe(false);
		expect(timeLeftText(t).hint).toBe('from your slice');
	});
});
