import { describe, expect, it } from 'vitest';
import { describeActivity, describeActivitySegments } from './activity.ts';
import { filterSteps } from './assembly.ts';
import { partGrams, plateFileRoleGrams } from './accounting.ts';
import { customPieceIdOf, isCustomPlate, isCustomSource, kitOnly, partBySlug } from './custom.ts';
import { makeView } from './fixtures.ts';
import type { ActivityItem, PartDef, Plate } from './types.ts';

const base = makeView();

function withCustom() {
	const view = makeView();
	const kit = view.parts[0];
	const cp: PartDef = {
		...kit,
		slug: 'custom-aa11',
		name: 'Beta handle',
		section: 'Custom',
		role: 'accent',
		bomGrams: null,
		qty: 1,
		components: [],
		custom: { pieceId: 'pc1' }
	};
	const pl: Plate = {
		number: 90,
		name: 'Beta handle',
		estSeconds: 3600,
		runs: 1,
		runNote: null,
		perPartRuns: false,
		parts: ['custom-aa11'],
		slicerGrams: 20,
		slicerByPart: {},
		gramsSource: 'file',
		thumbnailPath: null,
		filamentGrams: { accent: 15, primary: 5 },
		source: 'custom:pc1'
	};
	view.parts = [...view.parts, cp];
	view.state['custom-aa11'] = { ...view.state[kit.slug], slug: 'custom-aa11' };
	view.plates = [...view.plates, pl];
	return { view, cp, pl };
}

describe('custom helpers', () => {
	it('recognise custom sources and plates', () => {
		expect(isCustomSource('custom:pc1')).toBe(true);
		expect(isCustomSource('custom:')).toBe(false);
		expect(isCustomSource('upload:x')).toBe(false);
		expect(isCustomSource(null)).toBe(false);
		expect(customPieceIdOf('custom:pc1')).toBe('pc1');
		expect(customPieceIdOf('arranged')).toBeNull();
		expect(isCustomPlate({ source: 'custom:a' })).toBe(true);
	});
	it('partBySlug finds custom parts in parts and kit parts in allParts', () => {
		const { view } = withCustom();
		expect(partBySlug(view, 'custom-aa11')?.name).toBe('Beta handle');
		expect(view.allParts.some((p) => p.slug === 'custom-aa11')).toBe(false);
		expect(partBySlug(view, view.allParts[0].slug)).toBeDefined();
	});
	it('kitOnly drops custom parts, state and plates', () => {
		const { view } = withCustom();
		const k = kitOnly(view);
		expect(k.parts.some((p) => p.custom)).toBe(false);
		expect(k.state['custom-aa11']).toBeUndefined();
		expect(k.plates.some((p) => p.number === 90)).toBe(false);
		expect(k.plates.length).toBe(base.plates.length);
	});
});

describe('accounting with custom parts', () => {
	it('a custom part takes its plate grams (typed first, then file total)', () => {
		const { view } = withCustom();
		expect(partGrams(view, 'custom-aa11')).toMatchObject({ perRun: 20, total: 20, source: 'file' });
		view.plates.find((p) => p.number === 90)!.slicerGrams = null;
		expect(partGrams(view, 'custom-aa11')).toMatchObject({ perRun: 20, source: 'file' });
		view.state['custom-aa11'].manualGrams = 8;
		expect(partGrams(view, 'custom-aa11')).toMatchObject({ total: 8, source: 'user' });
	});
	it('a custom plate trusts every role of its file', () => {
		const { pl } = withCustom();
		expect(plateFileRoleGrams(pl, ['accent'])).toEqual({ accent: 15, primary: 5 });
		const kitPlate: Plate = { ...pl, source: 'upload:u1' };
		expect(plateFileRoleGrams(kitPlate, ['accent'])).toEqual({ accent: 15 });
	});
});

describe('assembly steps and skipped parts', () => {
	const rows = [
		{
			key: 'a.one',
			title: 'One',
			description: '',
			guidePage: null,
			parts: ['x', 'y'],
			hardware: [],
			checks: [],
			when: null
		}
	];
	it('keeps a step whose listed parts are all skipped, with an empty list', () => {
		const steps = filterSteps(rows, {}, new Set(['x', 'y']), new Set(['x', 'y']));
		expect(steps).toHaveLength(1);
		expect(steps[0].parts).toEqual([]);
		expect(filterSteps(rows, {}, new Set(['x', 'y']), new Set(['x']))[0].parts).toEqual(['y']);
	});
	it('still drops a step when every part is variant-inactive', () => {
		expect(filterSteps(rows, {}, new Set(), new Set())).toHaveLength(0);
	});
});

describe('activity sentences for skip and custom pieces', () => {
	const view = makeView();
	const say = (kind: string, payload: Record<string, unknown>) =>
		describeActivity(
			{
				id: 'a',
				userId: 'u1',
				userName: 'Steph',
				kind,
				payload,
				at: '2026-01-01T00:00:00.000Z'
			} as ActivityItem,
			view
		);
	it('part.skip / part.restore', () => {
		expect(say('part.skip', { slugs: ['a'], names: ['Handle Left'] })).toBe(
			'Steph marked Handle Left as not printing'
		);
		expect(
			say('part.skip', { slugs: ['a', 'b'], names: ['A', 'B'], plate: { number: 4, name: 'P' } })
		).toBe('Steph marked plate 4 as not printing');
		expect(say('part.restore', { slugs: ['a', 'b'], names: ['A', 'B'] })).toBe(
			'Steph brought A and B back into the build'
		);
		expect(say('part.skip', {})).toBe('Steph marked a part as not printing');
		const seg = describeActivitySegments(
			{
				id: 'a',
				userId: null,
				userName: 'S',
				kind: 'part.skip',
				payload: { names: ['A', 'B'], plate: { number: 4, name: 'P' } },
				at: ''
			},
			view
		);
		expect(seg.find((x) => x.plate === 4)).toBeDefined();
	});
	it('custom.add / custom.remove, control characters stripped', () => {
		expect(
			say('custom.add', {
				pieceId: 'p',
				name: 'Beta\u0001 handle',
				fileName: 'b.3mf',
				plates: [7, 8],
				sliced: true,
				replaced: ['Handle Left']
			})
		).toBe(
			'Steph added the custom piece "Beta handle" (b.3mf) on plate 7 and plate 8, replacing Handle Left'
		);
		expect(say('custom.remove', { pieceId: 'p', name: 'Beta', restored: ['Handle Left'] })).toBe(
			'Steph removed the custom piece "Beta" and brought back Handle Left'
		);
		expect(say('custom.remove', { name: 'Beta' })).toBe('Steph removed the custom piece "Beta"');
	});
});
