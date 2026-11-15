import { describe, expect, it } from 'vitest';
import { estPerRun, filamentStats, partGrams, plateGrams, unitUsed, units } from './accounting';
import { splitGramsByRole } from './spool-split';
import { applyPatches, makeView, run } from './fixtures';
import type { BuildView, Plate } from './types';

const plate = (v: BuildView, n: number) => v.plates.find((p) => p.number === n)!;
const unit = (v: BuildView, n: number, key?: string) =>
	units(v).find((u) => u.plate === n && (key ? u.key === key : true))!;
const withPlate = (v: BuildView, n: number, over: Partial<Plate>): BuildView => ({
	...v,
	plates: v.plates.map((p) => (p.number === n ? { ...p, ...over } : p))
});
const withManual = (v: BuildView, slug: string, g: number | null): BuildView => ({
	...v,
	state: { ...v.state, [slug]: { ...v.state[slug], manualGrams: g } }
});
const withSlice = (v: BuildView, slug: string, gramsByRole: Record<string, number>): BuildView => ({
	...v,
	partProfiles: {
		...v.partProfiles,
		[slug]: {
			secondsPerCopy: null,
			gramsByRole,
			method: 'exact',
			remapped: false,
			learnedRole: null,
			copies: 1,
			source: 'upload:x'
		}
	}
});
const done = (v: BuildView, slugs: string[]): BuildView => ({
	...v,
	state: {
		...v.state,
		...Object.fromEntries(slugs.map((s) => [s, { ...v.state[s], status: 'Printed' as const }]))
	}
});

describe('partGrams: typed > your slice > BOM > none', () => {
	it('uses the BOM total for all copies, flagged approximate', () => {
		const g = partGrams(makeView(), 'push-top');
		expect(g).toMatchObject({ total: 251, source: 'bom', approx: true, unknown: [] });
		expect(g.perRun).toBe(251);
	});

	it('does not multiply the BOM by the quantity (the part total already covers all copies)', () => {
		// push-brace: 166 g, x2
		expect(partGrams(makeView(), 'push-brace').total).toBe(166);
	});

	it('reports a part without any weight as unknown, never 0 g', () => {
		const g = partGrams(makeView(), 'rear-caster-left');
		expect(g).toMatchObject({ total: 0, perRun: 0, source: 'none', unknown: ['rear-caster-left'] });
	});

	it('your slice (per copy x quantity) beats the BOM', () => {
		const v = withSlice(makeView(), 'push-brace', { primary: 70 });
		expect(partGrams(v, 'push-brace')).toMatchObject({
			total: 140,
			source: 'slice',
			approx: false
		});
	});

	it('a typed weight beats your slice and the BOM, and fills a part that had none', () => {
		let v = withSlice(makeView(), 'push-brace', { primary: 70 });
		v = withManual(v, 'push-brace', 150);
		expect(partGrams(v, 'push-brace')).toMatchObject({ total: 150, source: 'user', approx: false });
		const w = withManual(makeView(), 'rear-caster-left', 88);
		expect(partGrams(w, 'rear-caster-left')).toMatchObject({
			total: 88,
			source: 'user',
			unknown: []
		});
	});

	it('perRun divides the part total by the plate runs (tires print twice)', () => {
		const g = partGrams(makeView(), 'tires');
		expect(g.total).toBe(901);
		expect(g.perRun).toBe(450.5);
	});

	it('a perPartRuns plate: a typed plate entry per part wins over a typed part weight, a file entry loses', () => {
		const base = makeView();
		const slug = plate(base, 13).parts[0];
		const typedPlate = withPlate(base, 13, { slicerByPart: { [slug]: 100 }, gramsSource: 'user' });
		expect(partGrams(withManual(typedPlate, slug, 300), slug)).toMatchObject({
			perRun: 100,
			total: 200,
			source: 'user'
		});
		const filePlate = withPlate(base, 13, { slicerByPart: { [slug]: 100 }, gramsSource: 'file' });
		expect(partGrams(withManual(filePlate, slug, 300), slug)).toMatchObject({
			total: 300,
			source: 'user'
		});
		expect(partGrams(filePlate, slug)).toMatchObject({ perRun: 100, total: 200, source: 'file' });
	});
});

describe('plateGrams: typed > sliced file > sum of parts', () => {
	it('sums the parts of a template plate', () => {
		const v = makeView();
		expect(plateGrams(v, plate(v, 10))).toMatchObject({
			perRun: 248,
			total: 248,
			source: 'bom',
			approx: true,
			unknown: []
		});
	});

	it('a typed plate total wins; the parts still show their own value', () => {
		const v = withPlate(makeView(), 10, { slicerGrams: 300, gramsSource: 'user' });
		expect(plateGrams(v, plate(v, 10))).toMatchObject({
			perRun: 300,
			source: 'user',
			approx: false
		});
		expect(partGrams(v, 'seat-back-top').total).toBe(113);
	});

	it('a slicer value from the file reads "file"; with no stored source it is treated as the file too', () => {
		const v = withPlate(makeView(), 10, { slicerGrams: 280, gramsSource: 'file' });
		expect(plateGrams(v, plate(v, 10)).source).toBe('file');
		const legacy = withPlate(makeView(), 10, { slicerGrams: 280, gramsSource: null });
		expect(plateGrams(legacy, plate(legacy, 10)).source).toBe('file');
	});

	it('the file total (filamentGrams) beats the parts, and a build slice reads "slice"', () => {
		const f = withPlate(makeView(), 10, { filamentGrams: { primary: 200, accent: 30 } });
		expect(plateGrams(f, plate(f, 10))).toMatchObject({
			perRun: 230,
			source: 'file',
			approx: false
		});
		const s = withPlate(makeView(), 10, {
			filamentGrams: { primary: 200 },
			gramsSource: 'slice'
		});
		expect(plateGrams(s, plate(s, 10)).source).toBe('slice');
	});

	it('multiplies by the plate runs for the total', () => {
		const v = makeView();
		expect(plateGrams(v, plate(v, 23))).toMatchObject({ perRun: 450.5, total: 901 });
	});

	it('a partly known plate gives the known total, flags it and names the missing part', () => {
		const v = makeView();
		const g = plateGrams(v, plate(v, 12));
		expect(g.total).toBe(460); // connectors 451 + hub caps 9
		expect(g.unknown).toEqual(['front-caster-mount']);
		expect(g.approx).toBe(true);
	});

	it('an all-unknown plate is none with every part listed', () => {
		const v = makeView();
		expect(plateGrams(v, plate(v, 9))).toMatchObject({
			total: 0,
			source: 'none',
			unknown: ['rear-caster-left', 'rear-caster-right']
		});
	});

	it('entering the missing weight completes the plate', () => {
		const v = withManual(makeView(), 'front-caster-mount', 40);
		const g = plateGrams(v, plate(v, 12));
		expect(g.total).toBe(500);
		expect(g.unknown).toEqual([]);
		// weakest source among the parts: connectors and hub caps are BOM
		expect(g.source).toBe('bom');
		const all = withManual(
			withManual(withManual(v, 'connectors', 450), 'hub-caps', 10),
			'front-caster-mount',
			40
		);
		expect(plateGrams(all, plate(all, 12))).toMatchObject({ source: 'user', approx: false });
	});

	it('a typed total covers the unknown parts', () => {
		const v = withPlate(makeView(), 9, { slicerGrams: 120, gramsSource: 'user' });
		expect(plateGrams(v, plate(v, 9))).toMatchObject({ perRun: 120, unknown: [] });
	});

	it('perPartRuns: one round of every part, all runs in the total', () => {
		const v = makeView();
		const g = plateGrams(v, plate(v, 13));
		expect(g.perRun).toBe(477);
		expect(g.total).toBe(954);
	});

	it('estPerRun delegates: same numbers for whole-plate, perPartRuns and unplated units', () => {
		const v = makeView();
		expect(estPerRun(v, unit(v, 10))).toBe(plateGrams(v, plate(v, 10)).perRun);
		expect(estPerRun(v, unit(v, 13, 'rims-1-4'))).toBe(238.5);
		const typed = withManual(v, 'rear-caster-left', 60);
		expect(estPerRun(typed, unit(typed, 9))).toBe(60);
	});
});

describe('unitUsed', () => {
	it('a finished unit with nothing logged uses its estimate', () => {
		const v = done(makeView(), ['seat-center']);
		expect(unitUsed(v, unit(v, 11))).toBe(180);
	});

	it('logged grams are used as logged', () => {
		let v = done(makeView(), ['seat-center']);
		v = { ...v, runs: [run({ plateNumber: 11, result: 'Success', grams: 175 })] };
		expect(unitUsed(v, unit(v, 11))).toBe(175);
	});

	it('Failed 40 g then a Success without grams: the kept part falls back to the estimate', () => {
		let v = done(makeView(), ['seat-center']);
		v = {
			...v,
			runs: [
				run({ plateNumber: 11, result: 'Failed', grams: 40 }),
				run({ plateNumber: 11, result: 'Success', grams: null })
			]
		};
		expect(unitUsed(v, unit(v, 11))).toBe(40 + 180);
	});

	it('Failed 40 g then a Success with grams counts both and nothing more', () => {
		let v = done(makeView(), ['seat-center']);
		v = {
			...v,
			runs: [
				run({ plateNumber: 11, result: 'Failed', grams: 40 }),
				run({ plateNumber: 11, result: 'Success', grams: 170 })
			]
		};
		expect(unitUsed(v, unit(v, 11))).toBe(210);
	});

	it('an unfinished unit counts only what was logged', () => {
		let v = makeView();
		v = { ...v, runs: [run({ plateNumber: 11, result: 'Failed', grams: 40 })] };
		expect(unitUsed(v, unit(v, 11))).toBe(40);
	});

	it('a two-run plate with one measured Success estimates the other run', () => {
		let v = done(makeView(), ['tires']);
		v = { ...v, runs: [run({ plateNumber: 23, result: 'Success', grams: 440 })] };
		expect(unitUsed(v, unit(v, 23))).toBeCloseTo(440 + 450.5);
	});
});

describe('filamentStats with parts that have no weight', () => {
	it('lists parts still to print without a weight, per role, instead of counting 0', () => {
		const v = makeView();
		const role = v.parts.find((p) => p.slug === 'front-caster-mount')!.role;
		const s = filamentStats(v).find((x) => x.role === role)!;
		expect(s.unknownParts).toContain('front-caster-mount');
		expect(s.unknownParts).toContain('rear-caster-left');
		expect(s.unweighed).toBe(s.unknownParts.length);
	});

	it('a partly known plate is counted (it was silently undercounted before)', () => {
		const v = makeView();
		const all = filamentStats(v).flatMap((s) => s.unknownParts);
		expect(all).toContain('front-caster-mount');
	});

	it('drops a part once its weight is entered or it is printed', () => {
		let v = withManual(makeView(), 'front-caster-mount', 40);
		expect(filamentStats(v).flatMap((s) => s.unknownParts)).not.toContain('front-caster-mount');
		v = done(makeView(), ['rear-caster-left', 'rear-caster-right']);
		expect(filamentStats(v).flatMap((s) => s.unknownParts)).not.toContain('rear-caster-left');
	});

	it('entered weight flows into the totals', () => {
		const base = makeView();
		const before = filamentStats(base).reduce((a, s) => a + s.need, 0);
		const after = filamentStats(withManual(base, 'front-caster-mount', 40)).reduce(
			(a, s) => a + s.need,
			0
		);
		expect(after - before).toBeCloseTo(40);
	});
});

describe('spool split uses the same part weights', () => {
	it('weights roles by each part total (typed weights included, quantity not applied twice)', () => {
		let v = makeView();
		const roles: Record<string, string> = {
			connectors: 'primary',
			'front-caster-mount': 'accent',
			'hub-caps': 'tire'
		};
		const setRoles = <T extends { slug: string; role: string }>(ps: T[]) =>
			ps.map((p) => (roles[p.slug] ? { ...p, role: roles[p.slug] } : p));
		v = { ...v, parts: setRoles(v.parts), allParts: setRoles(v.allParts) };
		v = withManual(v, 'front-caster-mount', 40);
		// connectors 451 g (BOM, qty none), front-caster-mount 40 g typed (qty 2), hub caps 9 g (qty 2)
		const out = splitGramsByRole(v, {
			plateNumber: 12,
			grams: 500,
			result: 'Success'
		} as never);
		expect(out.primary).toBeCloseTo((500 * 451) / 500, 1);
		expect(out.accent).toBeCloseTo((500 * 40) / 500, 1);
		expect(out.tire).toBeCloseTo((500 * 9) / 500, 1);
	});
});

describe('applyPatches carries manualGrams', () => {
	it('an optimistic patch sets it', () => {
		const v = applyPatches(makeView(), [{ slug: 'rear-caster-left', manualGrams: 77 }]);
		expect(partGrams(v, 'rear-caster-left')).toMatchObject({ total: 77, source: 'user' });
	});
});
