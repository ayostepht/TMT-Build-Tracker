import { describe, expect, it } from 'vitest';
import { plateGramsBadge } from './plate-grams.ts';
import { makeView } from './fixtures.ts';
import type { BuildView, Plate } from './types.ts';

const plate = (v: BuildView, n: number) => v.plates.find((p) => p.number === n)!;
const withPlate = (v: BuildView, n: number, over: Partial<Plate>): BuildView => ({
	...v,
	plates: v.plates.map((p) => (p.number === n ? { ...p, ...over } : p))
});
const withManual = (v: BuildView, slug: string, g: number): BuildView => ({
	...v,
	state: { ...v.state, [slug]: { ...v.state[slug], manualGrams: g } }
});

describe('plateGramsBadge', () => {
	it('an estimate from BOM weights is marked "~"', () => {
		const v = makeView();
		const pl = plate(v, 16); // push handle top: BOM 251 g
		const b = plateGramsBadge(v, pl)!;
		expect(b.main).toMatch(/^~\d+ g( per run)?$/);
		expect(b.flag).toBe('');
		expect(b.source).toBe('bom');
		expect(b.note).toBe('');
	});

	it('a plate with parts that have no weight shows a lower bound and the flag', () => {
		const v = makeView();
		const pl = plate(v, 9); // kit caster mounts have no BOM weight
		const b = plateGramsBadge(v, pl)!;
		expect(b.unknown.length).toBeGreaterThan(0);
		expect(b.flag).toBe(
			`${b.unknown.length} part${b.unknown.length === 1 ? '' : 's'} without weight`
		);
		if (b.main) expect(b.main.startsWith('≥ ')).toBe(true);
	});

	it('adding the weights removes the flag and sums the parts', () => {
		let v = makeView();
		const b0 = plateGramsBadge(v, plate(v, 9))!;
		for (const s of b0.unknown) v = withManual(v, s, 100);
		const b = plateGramsBadge(v, plate(v, 9))!;
		expect(b.flag).toBe('');
		expect(b.unknown).toEqual([]);
		expect(b.main.startsWith('≥')).toBe(false);
	});

	it('a typed plate total reads "your entry", exact, and total across runs', () => {
		const v = withPlate(makeView(), 1, {
			slicerGrams: 417,
			gramsSource: 'user',
			runs: 2,
			perPartRuns: false
		});
		const b = plateGramsBadge(v, plate(v, 1))!;
		expect(b).toMatchObject({
			main: '417 g per run',
			note: 'your entry',
			total: '834 g total',
			flag: ''
		});
	});

	it('a plate printed in runs of its own (the rims) shows one print, and the total of all prints', () => {
		let v = makeView();
		const [a, b2] = v.parts.slice(0, 2).map((p) => p.slug);
		v = withPlate(v, 1, {
			parts: [a, b2],
			runs: 2,
			perPartRuns: true,
			slicerByPart: { [a]: 240, [b2]: 240 },
			gramsSource: 'user',
			slicerGrams: undefined
		});
		const b = plateGramsBadge(v, plate(v, 1))!;
		expect(b.main).toBe('240 g per print');
		expect(b.total).toBe('960 g total');
	});

	it('a file total reads "from file"', () => {
		const v = withPlate(makeView(), 1, {
			slicerGrams: 330,
			gramsSource: 'file',
			runs: 1,
			perPartRuns: false
		});
		expect(plateGramsBadge(v, plate(v, 1))).toMatchObject({ main: '330 g', note: 'from file' });
	});

	it('a plate with no part in the build has no badge', () => {
		const v = withPlate(makeView(), 1, { parts: ['not-a-part'] });
		expect(plateGramsBadge(v, plate(v, 1))).toBeNull();
	});
});
