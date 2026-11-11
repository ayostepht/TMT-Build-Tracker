import { describe, expect, it } from 'vitest';
import { estPerRun, filamentStats, roleShares, units } from './accounting';
import { makeView, run } from './fixtures';
import type { BuildView } from './types';

function withFilamentGrams(v: BuildView, number: number, fg: Record<string, number>): BuildView {
	return {
		...v,
		plates: v.plates.map((p) => (p.number === number ? { ...p, filamentGrams: fg } : p))
	};
}
const stat = (v: BuildView, role: string) => filamentStats(v).find((s) => s.role === role)!;
const unit = (v: BuildView, n: number) => units(v).find((u) => u.plate === n)!;

describe('plates with grams per filament (sliced multi-filament prints)', () => {
	it('is unchanged when no plate has filamentGrams', () => {
		const v = makeView();
		const total = filamentStats(v).reduce((a, s) => a + s.total, 0);
		const same = filamentStats({
			...v,
			plates: v.plates.map((p) => ({ ...p, filamentGrams: {} }))
		});
		expect(same.reduce((a, s) => a + s.total, 0)).toBe(total);
	});

	it('splits a plate between the roles it uses', () => {
		const base = makeView();
		const plain = stat(base, 'primary').total;
		const v = withFilamentGrams(base, 1, { primary: 60, tire: 40 });
		const u = unit(v, 1);
		const oldRole = u.role;
		expect(estPerRun(v, u)).toBe(100);
		expect(roleShares(v, u)).toEqual({ primary: 0.6, tire: 0.4 });
		expect(stat(v, 'tire').total).toBeCloseTo(stat(base, 'tire').total + 40);
		// the plate's own role loses its old estimate and gains its share
		const oldEst = estPerRun(base, unit(base, 1));
		expect(stat(v, oldRole).total).toBeCloseTo(
			stat(base, oldRole).total -
				oldEst +
				(oldRole === 'primary' ? 60 : 0) +
				(oldRole === 'tire' ? 40 : 0)
		);
		expect(plain).toBeGreaterThan(0);
	});

	it('prefers slicer grams typed by the user for the total but keeps the split', () => {
		const v = withFilamentGrams(makeView(), 1, { primary: 75, accent: 25 });
		const p = v.plates.find((x) => x.number === 1)!;
		const w = { ...v, plates: v.plates.map((x) => (x === p ? { ...x, slicerGrams: 200 } : x)) };
		const u = unit(w, 1);
		expect(estPerRun(w, u)).toBe(200);
		expect(roleShares(w, u)).toEqual({ primary: 0.75, accent: 0.25 });
	});

	it('counts used and remaining grams per role', () => {
		const base = makeView();
		const v0 = withFilamentGrams(base, 1, { primary: 60, tire: 40 });
		const slug = unit(v0, 1).parts[0].slug;
		const printed: BuildView = {
			...v0,
			state: { ...v0.state, [slug]: { ...v0.state[slug], status: 'Printed' } }
		};
		const u = unit(printed, 1);
		expect(u.parts.every((p) => printed.state[p.slug].status === 'Printed')).toBe(true);
		const tire0 = stat(v0, 'tire');
		const tire1 = stat(printed, 'tire');
		expect(tire1.used).toBeCloseTo(tire0.used + 40);
		expect(tire1.need).toBeCloseTo(tire0.need - 40);
		// a logged run's grams are split by the same shares
		const logged: BuildView = { ...v0, runs: [run({ plateNumber: 1, grams: 50 })] };
		expect(stat(logged, 'tire').used - tire0.used).toBeCloseTo(20);
	});

	it('ignores filamentGrams on per-part-runs plates', () => {
		const v = withFilamentGrams(makeView(), 13, { primary: 10 });
		const u = units(v).find((x) => x.plate === 13)!;
		expect(roleShares(v, u)).toEqual({ [u.role]: 1 });
	});
});

describe('failed runs and filament used', () => {
	it('a Failed run with no grams counts as 0 g, never as the estimate', () => {
		const base = makeView();
		const u = unit(base, 1);
		const v = { ...base, runs: [run({ plateNumber: 1, result: 'Failed', grams: null })] };
		const used = (x: BuildView) => filamentStats(x).reduce((a, f) => a + f.used, 0);
		expect(estPerRun(base, u)).toBeGreaterThan(0);
		expect(used(v)).toBe(0);
		const logged = { ...base, runs: [run({ plateNumber: 1, result: 'Failed', grams: 12 })] };
		expect(used(logged)).toBe(12);
	});
});
