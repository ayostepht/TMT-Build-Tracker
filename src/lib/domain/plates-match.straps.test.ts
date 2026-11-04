import { describe, expect, it } from 'vitest';
import { matchObject, matchPlates, type MatchPart } from './plates-match.ts';
import { tmtTemplate } from '../server/seed/tmt';

const parts: MatchPart[] = tmtTemplate.parts.map((p) => ({
	slug: p.slug,
	name: p.name,
	sourceFile: p.sourceFile,
	notes: p.notes,
	allowedMaterials: p.allowedMaterials,
	components: p.components
}));

// Objects of the "TPU - HARNESS AND STRAPS" plate of MakeGood's H and X/P/A profiles.
const HARNESS_OBJECTS = [
	'TMT3D - HARNESS RIGHT',
	'TMT3D - HARNESS LEFT',
	'TMT3D - BUCKLE HOLDER.step',
	'3DTMT - STORAGE STRAP',
	'3DTMT - HARNESS STRAP LONG',
	'3DTMT - FOOTREST STRAP',
	'3DTMT - FOOTREST STRAP ',
	'3DTMT - HARNESS STRAP MEDIUM',
	'3DTMT - HARNESS STRAP SHORT',
	'3DTMT - LAP STRAP'
];

describe('harness and strap objects', () => {
	// some profiles slice the TPU plates with a PETG filament slot; the name decides, not the slot
	for (const type of ['TPU', 'PETG', null])
		it(`belong to the harness (filament ${type ?? 'unknown'})`, () => {
			for (const n of HARNESS_OBJECTS) {
				const m = matchObject(n, parts, { filamentType: type });
				expect([n, m.slug]).toEqual([n, 'harness']);
				expect(m.confidence).toBeGreaterThanOrEqual(0.8);
			}
		});

	it('keeps the footrest objects on the footrest parts', () => {
		for (const type of ['PETG', null])
			expect(
				matchObject('3DTMT I FOOTREST COMBINED REV A.STEP', parts, { filamentType: type }).slug
			).toBe('footrest');
		expect(matchObject('3DTMT I1 FOOTREST FRONT REV A.STEP', parts, {}).slug).toBe(
			'footrest-front'
		);
		expect(matchObject('3DTMT I2 FOOTREST REAR REV A.STEP', parts, {}).slug).toBe('footrest-rear');
	});
});

describe('generic object names on a named plate', () => {
	it('puts the TPU push handle grip on push-grip even with a PETG filament slot', () => {
		const objects = [{ id: '99', name: 'MG_PUSH HANDLE.step', filamentIndex: 1 }];
		for (const type of ['PETG', 'TPU']) {
			const m = matchPlates([{ index: 22, name: 'TPU - PUSH HANDLE GRIP', objects }], parts, [
				{ index: 1, type }
			]);
			expect(m['22:99'].slug).toBe('push-grip');
		}
		// the same object on the push handle top plate is not claimed by the grip
		const top = matchPlates([{ index: 16, name: 'PUSH HANDLE TOP', objects }], parts, [
			{ index: 1, type: 'PETG' }
		]);
		expect(top['16:99'].slug).not.toBe('push-grip');
	});
});
