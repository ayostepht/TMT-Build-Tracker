import { describe, expect, it } from 'vitest';
import { makeView } from './fixtures';
import {
	matchObject,
	matchPlates,
	normalizeName,
	objectKey,
	suggestVariants,
	slugsFor,
	type MatchPart
} from './plates-match';
import { decodeEntities, runsHintFromName } from './threemf';

const view = makeView();
const parts: MatchPart[] = view.allParts;
const slugOf = (name: string, filamentType?: string) =>
	matchObject(name, parts, { filamentType }).slug;

describe('normalizeName', () => {
	it('drops decoration', () => {
		const n = normalizeName('3DTMT XX PUSH HANDLE BOTTOM REV B V3.step');
		expect(n.core).toBe('push handle bottom');
		expect(n.rev).toBe('b');
		expect(normalizeName('3DTMT E1 CASTER MOUNT REAR LEFT REV A KIT.step').kit).toBe(true);
		expect(normalizeName('MG_HEADREST SCREW REV B').core).toBe('headrest screw');
		expect(normalizeName('3DTMT A1 HANDLE LEFT REV A.STEP').code).toBe('a1');
	});
});

describe('matchObject on the H-series object names', () => {
	const cases: [string, string][] = [
		['3DTMT A1 HANDLE LEFT REV A.STEP', 'handle-left'],
		['3DTMT A2 HANDLE RIGHT REV A.STEP', 'handle-right'],
		['3DTMT D1 STORAGE LEFT REV A.STEP', 'storage-left'],
		['3DTMT D2 STORAGE RIGHT REV A.STEP', 'storage-right'],
		['3DTMT B1 WHEEL MOUNT LEFT REV A.STEP', 'wheel-mount-left'],
		['3DTMT B2 WHEEL MOUNT RIGHT REV A.STEP', 'wheel-mount-right'],
		['3DTMT C1 WING LEFT REV B.step', 'wing-left'],
		['3DTMT C2 WING RIGHT REV B.step', 'wing-right'],
		['3DTMT F SEAT BACK CENTER TOP REV A.STEP', 'seat-back-top'],
		['3DTMT G SEAT BACK CENTER BOTTOM REV A.STEP', 'seat-back-bottom'],
		['3DTMT H SEAT CENTER REV A.STEP', 'seat-center'],
		['3DTMT E1 CASTER MOUNT REAR LEFT REV A.STEP', 'rear-caster-left-mcmaster'],
		['3DTMT E2 CASTER MOUNT REAR RIGHT REV A.STEP', 'rear-caster-right-mcmaster'],
		['3DTMT E2 CASTER MOUNT REAR RIGHT REV A KIT.step', 'rear-caster-right'],
		['3DTMT E1 CASTER MOUNT REAR LEFT REV A KIT.step', 'rear-caster-left'],
		['3DTMT XX HEADREST MOUNT REV A.STEP', 'headrest-mount'],
		['3DTMT I1 FOOTREST FRONT REV A.STEP', 'footrest-front'],
		['3DTMT I2 FOOTREST REAR REV A.STEP', 'footrest-rear'],
		['3DTMT I FOOTREST COMBINED REV A.STEP', 'footrest'],
		['MG_HEADREST SCREW REV B.STEP', 'headrest-bolt'],
		['MG_HEADREST BASE REV B.STEP', 'headrest-brace'],
		['3DTMT J FRAME PIN REV A.STEP', 'connectors'],
		['3DTMT L FRONT CASTER PIN REV A.STEP', 'connectors'],
		['3DTMT N WHEEL BLOCK REV A.STEP', 'connectors'],
		['3DTMT Q WHEEL PIN REV A.STEP', 'connectors'],
		['3DTMT R BEARING SPACER REV A.STEP', 'connectors'],
		['3DTMT 4MM WASHER.step', 'connectors'],
		['3DTMT S BOLT CAP REV A.STEP', 'hub-caps'],
		['3D TMT K FRONT CASTER MOUNT REV C.step', 'front-caster-mount'],
		['3DTMT XX PUSH HANDLE TOP REV B.STEP', 'push-top'],
		['3DTMT XX PUSH HANDLE PIN REV B.STEP', 'push-pin'],
		['3DTMT XX PUSH HANDLE BRACE REV B.STEP', 'push-brace'],
		['3DTMT XX PUSH HANDLE BOTTOM REV B V3.step', 'push-bottom'],
		['TMT_SinglePIecehandle.stl', 'push-handle-one-piece'],
		['TMT3D - HARNESS RIGHT', 'harness'],
		['TMT3D - HARNESS LEFT', 'harness'],
		['TMT3D - BUCKLE HOLDER.step', 'harness'],
		['3DTMT - STORAGE STRAP', 'harness'],
		['3DTMT - FOOTREST STRAP', 'harness'],
		['3DTMT - LAP STRAP', 'harness'],
		['3DTMT - HARNESS STRAP MEDIUM', 'harness'],
		['MG_2 PART CUSHION BASE.step', 'cushion-base'],
		['MG_2 PART CUSHION TOP.step', 'cushion-top'],
		['MG_HEADREST CUSHION.step', 'soft-headrest'],
		['3DTMT P TIRE REV A.STEP', 'tires'],
		['TMT3D - SLIDE 30MM.step', 'buckles'],
		['3.2 cm - Side A.stl', 'buckles']
	];
	for (const [name, slug] of cases)
		it(`${name} -> ${slug}`, () => {
			const type =
				/^(MG_2|MG_HEADREST CUSHION|TMT3D - HARNESS|TMT3D - BUCKLE HOLDER|3DTMT - |3DTMT P TIRE)/.test(
					name
				)
					? 'TPU'
					: 'PETG';
			expect(slugOf(name, type)).toBe(slug);
		});

	it('matches the one-piece push handle with high confidence and never as a multi-part piece', () => {
		const m = matchObject('TMT_SinglePIecehandle.stl', parts, { filamentType: 'PETG' });
		expect(m.slug).toBe('push-handle-one-piece');
		expect(m.confidence).toBeGreaterThanOrEqual(0.9);
		// the multi-part names still go to their own parts
		expect(slugOf('3DTMT XX PUSH HANDLE TOP REV B.STEP', 'PETG')).toBe('push-top');
	});

	it('suggests the one-piece option from the one-piece handle (the shared grip does not tip it)', () => {
		const groups = view.variantGroups;
		expect(suggestVariants(groups, ['push-handle-one-piece', 'push-grip'])['push-handle']).toBe(
			'one-piece'
		);
		expect(suggestVariants(groups, ['push-handle-one-piece'])['push-handle']).toBe('one-piece');
		expect(
			suggestVariants(groups, ['push-top', 'push-bottom', 'push-pin', 'push-grip'])['push-handle']
		).toBe('include');
		// the grip alone says nothing about the handle
		expect(suggestVariants(groups, ['push-grip'])['push-handle']).toBeUndefined();
	});

	it('uses the material to tell the grip from the push handle parts', () => {
		expect(slugOf('MG_PUSH HANDLE.step', 'TPU')).toBe('push-grip');
	});

	it('picks the rim by revision, and names the two parts that share the file', () => {
		const rimB = matchObject('3DTMT O WHEEL RIM REV B.STEP', parts, { filamentType: 'PETG' });
		expect(['rims-1-4', 'rims-2-3']).toContain(rimB.slug);
		// the two halves are twins (same source file): not an ambiguity, and the match names them
		expect(rimB.twins).toEqual(['rims-1-4', 'rims-2-3']);
		expect(rimB.confidence).toBeGreaterThan(0.8);
		const rimA = matchObject('3DTMT O WHEEL RIM REV A.STEP', parts, { filamentType: 'PETG' });
		expect(['rims-small-1-4', 'rims-small-2-3']).toContain(rimA.slug);
	});

	it('does not invent matches', () => {
		const m = matchObject('Benchy boat.stl', parts);
		expect(m.slug).toBeNull();
		expect(matchObject('', parts).slug).toBeNull();
	});

	it('never swaps left and right', () => {
		expect(slugOf('Totally renamed HANDLE LEFT')).toBe('handle-left');
		expect(slugOf('Totally renamed HANDLE RIGHT')).toBe('handle-right');
	});

	it('falls back to part names when the object is named after the part, not the file', () => {
		const fusion: MatchPart[] = [
			{ slug: 'a', name: 'Rear Bracket', sourceFile: 'Multiple files' },
			{ slug: 'b', name: 'Front Bracket', sourceFile: 'Multiple files' }
		];
		expect(matchObject('FusionComponent Rear Bracket', fusion).slug).toBe('a');
		expect(matchObject('Front bracket v12', fusion).slug).toBe('b');
	});
});

describe('plate level helpers', () => {
	it('matches whole plates and keeps unique slugs per plate', () => {
		const plates = [
			{
				index: 1,
				objects: [
					{ id: '1', name: '3DTMT A1 HANDLE LEFT REV A.STEP', filamentIndex: 1 },
					{ id: '2', name: 'Unknown thing', filamentIndex: 1 },
					{ id: '3', name: '3DTMT J FRAME PIN REV A.STEP', filamentIndex: 1 },
					{ id: '4', name: '3DTMT Q WHEEL PIN REV A.STEP', filamentIndex: 1 }
				]
			}
		];
		const m = matchPlates(plates, parts, [{ index: 1, type: 'PETG' }]);
		const mapping = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.slug]));
		expect(mapping[objectKey(1, '2')]).toBeNull();
		expect(slugsFor(1, plates[0].objects, mapping)).toEqual(['handle-left', 'connectors']);
	});

	it('suggests variant choices from matched parts, none on a tie', () => {
		const groups = view.variantGroups;
		const s = suggestVariants(groups, ['footrest-front', 'footrest-rear', 'rims-small-1-4']);
		expect(s.footrest).toBe('two-piece');
		expect(s.rim).toBe('smaller');
		expect(s.seat).toBeUndefined();
		const tie = suggestVariants(groups, ['rear-caster-left', 'rear-caster-left-mcmaster']);
		expect(tie['rear-caster']).toBeUndefined();
		expect(suggestVariants(groups, ['rear-caster-left-mcmaster'])['rear-caster']).toBe('mcmaster');
	});
});

describe('3MF name helpers', () => {
	it('reads runs from plate names', () => {
		expect(runsHintFromName('WHEEL RIM (PRINT X4)')).toBe(4);
		expect(runsHintFromName('WHEEL RIM SMALLER (PRINT X4)')).toBe(4);
		expect(runsHintFromName('Tires (x2)')).toBe(2);
		expect(runsHintFromName('print 3 times')).toBe(3);
		expect(runsHintFromName('WING LEFT')).toBe(1);
		expect(runsHintFromName('Plate 7')).toBe(1);
	});
	it('decodes entities, also when escaped twice', () => {
		expect(decodeEntities('PETG &amp; TPU')).toBe('PETG & TPU');
		expect(decodeEntities('A &amp;amp; B &#65;&#x42; &lt;x&gt;')).toBe('A & B AB <x>');
		expect(decodeEntities('plain')).toBe('plain');
	});
});

describe('Elegoo Slicer names (underscores for spaces)', () => {
	it('match like the spaced names', () => {
		expect(normalizeName('3DTMT_J_FRAME_PIN_REV_A.STEP').core).toBe(
			normalizeName('3DTMT J FRAME PIN REV A.STEP').core
		);
		expect(slugOf('3DTMT_J_FRAME_PIN_REV_A.STEP')).toBe('connectors');
		expect(slugOf('3DTMT_A1_HANDLE_LEFT_REV_A.STEP')).toBe(
			slugOf('3DTMT A1 HANDLE LEFT REV A.STEP')
		);
	});
});
