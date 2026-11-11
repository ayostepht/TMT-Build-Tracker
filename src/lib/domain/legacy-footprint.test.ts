import { describe, expect, it } from 'vitest';
import { arrange, type ArrangeRole } from './arrange.ts';
import type { PrintFootprint } from './print-footprint.ts';

const roles: ArrangeRole[] = [{ key: 'primary', name: 'Primary', material: 'PETG' }];

/**
 * Footprint rows (`template_print_geometry.footprint`) and kit packs written before the 3D
 * re-orientation code was removed still carry `orient` and `sil.poses`. They are plain JSON
 * (no schema validation), so those keys must be ignored everywhere.
 */
describe('legacy footprint JSON', () => {
	const legacyJson = JSON.stringify({
		slug: 'wing',
		pieces: [
			{
				name: 'wing',
				w: 100,
				d: 40,
				h: 20,
				copies: 2,
				hull: [
					[-50, -20],
					[50, -20],
					[50, 20],
					[-50, 20]
				],
				orient: {
					v: 2,
					profile: { contactArea: 4000, supportScore: 0 },
					poses: [{ m: [1, 0, 0, 0, 0, 1, 0, 1, 0], t: [0, 0, 0] }]
				},
				sil: {
					v: 1,
					profile: {
						rings: [
							[
								[-50, -20],
								[50, -20],
								[50, 20],
								[-50, 20]
							]
						],
						pole: [0, 0],
						r: 20
					},
					poses: [{ rings: [], pole: [0, 0], r: 0 }]
				}
			}
		]
	});

	it('loads and arranges flat, ignoring orient and sil.poses', () => {
		const footprint = JSON.parse(legacyJson) as PrintFootprint;
		const res = arrange({
			parts: [{ slug: 'wing', name: 'Wing', role: 'primary', units: 1, grams: 50, footprint }],
			roles,
			printer: { bedX: 256, bedY: 256, margin: 5, spacing: 8, mmSlots: 1 }
		});
		expect(res.plates).toHaveLength(1);
		expect(res.plates[0].oversize).toBeFalsy();
		expect(res.plates[0].items).toHaveLength(2);
		for (const i of res.plates[0].items) expect(i.rotation % 90).toBe(0);
	});
});
