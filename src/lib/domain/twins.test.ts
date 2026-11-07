import { describe, expect, it } from 'vitest';
import { filamentStats, units, estTotal } from './accounting';
import { makeView } from './fixtures';
import { matchObject } from './plates-match';
import { planPlateParts, splitTwinRuns, twinGroups, twinKey, twinsOf } from './twins';
import type { BuildView } from './types';

const view = makeView();
const groups = twinGroups(view.allParts);

describe('twin detection', () => {
	it('groups parts that share a source file, and nothing else', () => {
		expect(groups).toContainEqual(['rims-1-4', 'rims-2-3']);
		expect(groups).toContainEqual(['rims-small-1-4', 'rims-small-2-3']);
		expect(groups.every((g) => g.length > 1)).toBe(true);
		// the placeholder shared by unrelated parts is no source object
		expect(twinKey({ slug: 'x', sourceFile: 'MakerWorld 3mf only (not in STEP pack)' })).toBeNull();
		expect(twinsOf('rims-2-3', groups)).toEqual(['rims-1-4', 'rims-2-3']);
		expect(twinsOf('wing-left', groups)).toEqual(['wing-left']);
	});

	it('also groups parts whose components resolve to the same files', () => {
		const g = twinGroups([
			{ slug: 'a', sourceFile: '', components: [{ name: 'x', file: 'P.STEP' }] },
			{ slug: 'b', sourceFile: 'n/a', components: [{ name: 'y', file: 'p.step' }] },
			{ slug: 'c', sourceFile: '', components: [{ name: 'z', file: 'Q.STEP' }] }
		]);
		expect(g).toEqual([['a', 'b']]);
	});

	it('the matcher names the twins and does not cap their confidence', () => {
		const m = matchObject('3DTMT O WHEEL RIM REV B.STEP', view.allParts, { filamentType: 'PETG' });
		expect(m.twins).toEqual(['rims-1-4', 'rims-2-3']);
		expect(m.confidence).toBeGreaterThan(0.8);
		expect(matchObject('3DTMT A1 HANDLE LEFT REV A.STEP', view.allParts).twins).toBeUndefined();
	});
});

describe('splitTwinRuns', () => {
	it('divides evenly or rounds up', () => {
		expect(splitTwinRuns(4, 2)).toEqual({ perPart: 2, even: true });
		expect(splitTwinRuns(3, 2)).toEqual({ perPart: 2, even: false });
		expect(splitTwinRuns(1, 2)).toEqual({ perPart: 1, even: false });
	});
});

describe('planPlateParts', () => {
	const base = {
		plateIndex: 13,
		objects: [{ id: '5' }],
		mapping: { '13:5': 'rims-1-4' } as Record<string, string | null>,
		groups,
		isActive: (s: string) => !s.startsWith('rims-small'),
		runsHint: 4
	};
	it('puts every active twin on the plate and shares the runs', () => {
		const p = planPlateParts(base);
		expect(p).toMatchObject({
			parts: ['rims-1-4', 'rims-2-3'],
			perPartRuns: true,
			runs: 2,
			totalRuns: 4,
			warning: null
		});
		expect(p.expansions).toEqual([
			{ key: '13:5', from: 'rims-1-4', twins: ['rims-1-4', 'rims-2-3'] }
		]);
	});
	it('rounds odd counts up and warns', () => {
		const p = planPlateParts({ ...base, runsHint: 3 });
		expect(p).toMatchObject({ runs: 2, perPartRuns: true });
		expect(p.warning).toMatch(/do not divide evenly/);
	});
	it('uses one run for a plain count of 1 and warns', () => {
		expect(planPlateParts({ ...base, runsHint: 1 })).toMatchObject({ runs: 1, perPartRuns: true });
	});
	it('can be overridden to the single mapped part', () => {
		const p = planPlateParts({ ...base, single: { '13:5': true } });
		expect(p).toMatchObject({ parts: ['rims-1-4'], perPartRuns: false, runs: 4 });
	});
	it('ignores inactive twins and leaves non-twin parts alone', () => {
		expect(planPlateParts({ ...base, isActive: (s) => s === 'rims-1-4' })).toMatchObject({
			parts: ['rims-1-4'],
			perPartRuns: false,
			runs: 4
		});
		expect(
			planPlateParts({ ...base, mapping: { '13:5': 'wing-left' }, runsHint: 2 })
		).toMatchObject({ parts: ['wing-left'], perPartRuns: false, runs: 2 });
	});
	it('keeps a plate that already names every twin as it is', () => {
		const p = planPlateParts({
			...base,
			objects: [{ id: '5' }, { id: '6' }],
			mapping: { '13:5': 'rims-1-4', '13:6': 'rims-2-3' }
		});
		expect(p).toMatchObject({ parts: ['rims-1-4', 'rims-2-3'], perPartRuns: false, runs: 4 });
	});
	it('does not share out a plate that mixes twins with other parts', () => {
		const p = planPlateParts({
			...base,
			objects: [{ id: '5' }, { id: '6' }],
			mapping: { '13:5': 'rims-1-4', '13:6': 'wing-left' }
		});
		expect(p.perPartRuns).toBe(false);
		expect(p.parts).toEqual(['rims-1-4', 'wing-left']);
		expect(p.warning).toMatch(/mixes/);
	});
});

describe('accounting for a twin plate', () => {
	function withTwinPlate(v: BuildView, grams: number): BuildView {
		return {
			...v,
			plates: v.plates.map((p) =>
				p.number === 13
					? {
							...p,
							parts: ['rims-1-4', 'rims-2-3'],
							perPartRuns: true,
							runs: 2,
							slicerGrams: grams,
							slicerByPart: { 'rims-1-4': grams, 'rims-2-3': grams },
							filamentGrams: {}
						}
					: p
			)
		};
	}
	it('counts the rims four times, each pair in its own color', () => {
		const v = withTwinPlate(makeView(), 100);
		const rims = units(v).filter((u) => u.plate === 13);
		expect(rims.map((u) => [u.key, u.runs])).toEqual([
			['rims-1-4', 2],
			['rims-2-3', 2]
		]);
		expect(rims.reduce((a, u) => a + estTotal(v, u), 0)).toBe(400);
		// no rim half is counted again as an unplaced part
		expect(units(v).filter((u) => u.parts.some((p) => p.slug.startsWith('rims-')))).toHaveLength(2);
		const role = (slug: string) => v.parts.find((p) => p.slug === slug)!.role;
		expect(role('rims-1-4')).not.toBe(role('rims-2-3'));
		const before = filamentStats(makeView());
		const after = filamentStats(v);
		const delta = (r: string) =>
			after.find((s) => s.role === r)!.total - before.find((s) => s.role === r)!.total;
		// 2 runs x 100 g in each of the two roles, less what the template estimated for them
		const est = (slug: string) => {
			const u = units(makeView()).find((x) => x.key === slug)!;
			return estTotal(makeView(), u);
		};
		expect(delta(role('rims-1-4'))).toBeCloseTo(200 - est('rims-1-4'));
		expect(delta(role('rims-2-3'))).toBeCloseTo(200 - est('rims-2-3'));
	});
});
