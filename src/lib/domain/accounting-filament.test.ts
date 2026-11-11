import { describe, expect, it } from 'vitest';
import { estPerRun, filamentStats, plateFileRoleGrams, roleShares, units } from './accounting';
import { splitGramsByRole } from './spool-split';
import { makeView, run } from './fixtures';
import type { BuildView } from './types';

function withFilamentGrams(v: BuildView, number: number, fg: Record<string, number>): BuildView {
	return {
		...v,
		plates: v.plates.map((p) => (p.number === number ? { ...p, filamentGrams: fg } : p))
	};
}
/** Give the active parts on a plate these roles (cycled), in the view's parts and allParts. */
function withRoles(v: BuildView, number: number, roles: string[]): BuildView {
	const slugs = v.plates.find((p) => p.number === number)!.parts;
	const roleOf = new Map(slugs.map((s, i) => [s, roles[i % roles.length]]));
	const set = <T extends { slug: string; role: string }>(ps: T[]) =>
		ps.map((p) => (roleOf.has(p.slug) ? { ...p, role: roleOf.get(p.slug)! } : p));
	return { ...v, parts: set(v.parts), allParts: set(v.allParts) };
}
/** A plate that is not perPartRuns and has 2+ parts. */
const multiPlate = (v: BuildView) =>
	v.plates.find((p) => !p.perPartRuns && p.parts.length >= 2)!.number;
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
		const b0 = makeView();
		const N = multiPlate(b0);
		const base = withRoles(b0, N, ['primary', 'tire']);
		const plain = stat(base, 'primary').total;
		const v = withFilamentGrams(base, N, { primary: 60, tire: 40 });
		const u = unit(v, N);
		const oldRole = u.role;
		expect(estPerRun(v, u)).toBe(100);
		expect(roleShares(v, u)).toEqual({ primary: 0.6, tire: 0.4 });
		expect(stat(v, 'tire').total).toBeCloseTo(stat(base, 'tire').total + 40);
		// the plate's own role loses its old estimate and gains its share
		const oldEst = estPerRun(base, unit(base, N));
		expect(stat(v, oldRole).total).toBeCloseTo(
			stat(base, oldRole).total -
				oldEst +
				(oldRole === 'primary' ? 60 : 0) +
				(oldRole === 'tire' ? 40 : 0)
		);
		expect(plain).toBeGreaterThan(0);
	});

	it('prefers slicer grams typed by the user for the total but keeps the split', () => {
		const b0 = makeView();
		const N = multiPlate(b0);
		const v = withFilamentGrams(withRoles(b0, N, ['primary', 'accent']), N, {
			primary: 75,
			accent: 25
		});
		const p = v.plates.find((x) => x.number === N)!;
		const w = { ...v, plates: v.plates.map((x) => (x === p ? { ...x, slicerGrams: 200 } : x)) };
		const u = unit(w, N);
		expect(estPerRun(w, u)).toBe(200);
		expect(roleShares(w, u)).toEqual({ primary: 0.75, accent: 0.25 });
	});

	it('counts used and remaining grams per role', () => {
		const b0 = makeView();
		const N = multiPlate(b0);
		const base = withRoles(b0, N, ['primary', 'tire']);
		const v0 = withFilamentGrams(base, N, { primary: 60, tire: 40 });
		const state = { ...v0.state };
		for (const s of unit(v0, N).parts.map((p) => p.slug))
			state[s] = { ...state[s], status: 'Printed' };
		const printed: BuildView = { ...v0, state };
		const u = unit(printed, N);
		expect(u.parts.every((p) => printed.state[p.slug].status === 'Printed')).toBe(true);
		const tire0 = stat(v0, 'tire');
		const tire1 = stat(printed, 'tire');
		expect(tire1.used).toBeCloseTo(tire0.used + 40);
		expect(tire1.need).toBeCloseTo(tire0.need - 40);
		// a logged run's grams are split by the same shares
		const logged: BuildView = { ...v0, runs: [run({ plateNumber: N, grams: 50 })] };
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

describe('the plate parts decide the roles of a sliced file grams', () => {
	const b0 = makeView();
	const N = multiPlate(b0);
	const prep = (roles: string[], fg: Record<string, number>, grams?: number) => {
		const v = withFilamentGrams(withRoles(b0, N, roles), N, fg);
		return grams == null ? v : { ...v, runs: [run({ plateNumber: N, result: 'Success', grams })] };
	};
	const slugsOf = (v: BuildView) => new Set(unit(v, N).parts.map((p) => p.slug));

	it('drops a file role no part has (all-accent plate, tire slot in the file)', () => {
		const v = prep(['accent'], { tire: 433.82, soft: 0.53 }, 424);
		const u = unit(v, N);
		expect(roleShares(v, u)).toEqual({ accent: 1 });
		expect(estPerRun(v, u)).toBeCloseTo(434.35);
		expect(stat(v, 'tire').used).toBe(0);
		expect(stat(v, 'soft').used).toBe(0);
		expect(stat(v, 'accent').used).toBe(424);
		expect(splitGramsByRole(v, { plateNumber: N, grams: 424, result: 'Success' } as never)).toEqual(
			{ accent: 424 }
		);
	});

	it('sends the grams of a one-role plate to that role (accent and soft slots are artefacts)', () => {
		const v = prep(['primary'], { accent: 17.15, primary: 223.15, soft: 0.96 }, 240);
		const u = unit(v, N);
		expect(roleShares(v, u)).toEqual({ primary: 1 });
		expect(stat(v, 'accent').used).toBe(0);
		expect(stat(v, 'soft').used).toBe(0);
		expect(stat(v, 'primary').used).toBe(240);
		expect(splitGramsByRole(v, { plateNumber: N, grams: 240, result: 'Success' } as never)).toEqual(
			{ primary: 240 }
		);
	});

	it('splits a two-role plate by file grams and drops the stray role', () => {
		const v = prep(['primary', 'accent'], { primary: 300, accent: 100, soft: 2 }, 200);
		const u = unit(v, N);
		expect(roleShares(v, u)).toEqual({ primary: 0.75, accent: 0.25 });
		expect(splitGramsByRole(v, { plateNumber: N, grams: 200, result: 'Success' } as never)).toEqual(
			{ primary: 150, accent: 50 }
		);
		expect(slugsOf(v).size).toBeGreaterThanOrEqual(2);
	});

	it('falls back to the parts when the file has no data or no overlap', () => {
		const none = prep(['accent'], {});
		expect(roleShares(none, unit(none, N))).toEqual({ accent: 1 });
		const plate = none.plates.find((p) => p.number === N)!;
		expect(plateFileRoleGrams(plate, ['accent'])).toBeNull();
		expect(plateFileRoleGrams({ ...plate, filamentGrams: { tire: 5 } }, ['accent'])).toBeNull();
		const split = splitGramsByRole(none, { plateNumber: N, grams: 90, result: 'Success' } as never);
		expect(Object.keys(split)).toEqual(['accent']);
		expect(split.accent).toBe(90);
	});
});
