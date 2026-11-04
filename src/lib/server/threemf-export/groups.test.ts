import { describe, expect, it } from 'vitest';
import { arrange } from '#lib/domain/arrange.ts';
import { GROUP_VERSION } from '#lib/domain/print-footprint.ts';
import type { Pt } from '#lib/domain/geom2d.ts';
import { itemTransform } from './writer';

/** A right triangle piece (100 x 100 box); two of them turned 180 degrees make the source's square. */
const tri: Pt[] = [
	[-50, -50],
	[50, -50],
	[-50, 50]
];
const square: Pt[] = [
	[-50, -50],
	[50, -50],
	[50, 50],
	[-50, 50]
];

describe('export placement of a rigid group', () => {
	it('puts every piece at group transform x piece offset', () => {
		const r = arrange({
			parts: [
				{
					slug: 'tris',
					name: 'Tris',
					role: 'primary',
					units: 1,
					footprint: {
						slug: 'tris',
						pieces: [{ name: 'tri', w: 100, d: 100, h: 10, copies: 2, hull: tri }],
						groups: [
							{
								v: GROUP_VERSION,
								plate: 1,
								items: [
									{ piece: 0, x: 0, y: 0, rot: 0 },
									{ piece: 0, x: 0, y: 0, rot: 180 }
								],
								w: 100,
								d: 100,
								outline: [square],
								hull: square
							}
						]
					}
				}
			],
			roles: [{ key: 'primary', name: 'P', material: 'PETG' }],
			// two 100 x 100 boxes do not fit this bed; the interlocking source square does
			printer: { bedX: 110, bedY: 110, margin: 5, spacing: 8, mmSlots: 1 }
		});
		expect(r.plates).toHaveLength(1);
		const items = r.plates[0].items;
		expect(items).toHaveLength(2);
		expect(items[0].group).toBe(items[1].group);
		const world = items.map((it) => {
			const t = itemTransform(
				{
					objectId: 1,
					instanceId: 0,
					x: it.x,
					y: it.y,
					w: it.w,
					d: it.d,
					rotation: it.rotation,
					ox: it.ox,
					oy: it.oy
				},
				0,
				0
			)
				.split(' ')
				.map(Number);
			return {
				origin: [t[9], t[10]],
				pts: tri.map(([x, y]) => [x * t[0] + y * t[3] + t[9], x * t[1] + y * t[4] + t[10]] as Pt)
			};
		});
		// both meshes share the group origin, turned 180 degrees against each other
		expect(world[0].origin[0]).toBeCloseTo(world[1].origin[0], 1);
		expect(world[0].origin[1]).toBeCloseTo(world[1].origin[1], 1);
		expect((((items[1].rotation - items[0].rotation) % 360) + 360) % 360).toBeCloseTo(180, 1);
		// together they cover one 100 x 100 square inside the bed
		const all = world.flatMap((w) => w.pts);
		const xs = all.map((p) => p[0]);
		const ys = all.map((p) => p[1]);
		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 0);
		expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100, 0);
		expect(Math.min(...xs)).toBeGreaterThanOrEqual(4.9);
		expect(Math.max(...xs)).toBeLessThanOrEqual(105.1);
	});
});
