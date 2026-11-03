import { describe, expect, it } from 'vitest';
import {
	aabbUnion,
	DEFAULT_GROUND_Y,
	fitMountFrame,
	frontCasterAnchors,
	FRONT_CASTER,
	harnessLayout,
	REAR_CASTER,
	rearCasterAnchor,
	type Aabb
} from './standins.ts';

// Boxes measured on the TMT assembly (mm).
const mountR: Aabb = { min: [-193.5, -39.3, -141.6], max: [-156, 17.2, -29.8] };
const mountL: Aabb = { min: [156, -39.3, -141.6], max: [193.5, 17.2, -29.8] };
const rearLeft: Aabb = { min: [-14.9, 92, -662.5], max: [89.9, 185.6, -454.9] };
const rearRight: Aabb = { min: [-89.9, 92, -662.5], max: [15.3, 185.6, -454.9] };

describe('caster anchors', () => {
	it('one front caster per mount instance, centred under it with the wheel in the arch', () => {
		const a = frontCasterAnchors([mountR, mountL]);
		expect(a).toHaveLength(2);
		expect(a[0].x).toBeCloseTo(-174.75, 2);
		expect(a[1].x).toBeCloseTo(174.75, 2);
		expect(a[0].z).toBeCloseTo(-85.7, 2);
		expect(a[0].topY).toBeLessThan(17.2);
		expect(a[0].topY - a[0].groundY).toBe(FRONT_CASTER.drop);
		expect(a[0].topY - a[0].groundY).toBeGreaterThan(2 * a[0].wheelR);
	});
	it('fits the mount underside plane and hangs the caster from the pin hole', () => {
		// Underside y = -5 - 1.2 (x - 175), sampled either side of a pin hole at (175, 10).
		const under: [number, number, number][] = [];
		for (const dx of [-9, -7, 7, 9, 11])
			for (const z of [0, 8, 16]) under.push([175 + dx, -5 - 1.2 * dx, z]);
		const f = fitMountFrame(under, [[175, 10]])!;
		expect(f.pivot[0]).toBeCloseTo(175, 5);
		expect(f.pivot[1]).toBeCloseTo(-5, 4);
		expect(f.pivot[2]).toBeCloseTo(10, 5);
		expect(Math.hypot(...f.up)).toBeCloseTo(1, 6);
		expect(f.up[0]).toBeCloseTo(1.2 / Math.hypot(1.2, 1), 6);
		const [anchor] = frontCasterAnchors([mountL], [f]);
		expect(anchor.up).toEqual(f.up);
		expect(anchor.topY).toBeCloseTo(-5, 4);
		expect(fitMountFrame(under.slice(0, 3), [])).toBeNull();
	});
	it('no mounts, no casters', () => {
		expect(frontCasterAnchors([])).toEqual([]);
		expect(rearCasterAnchor([], DEFAULT_GROUND_Y)).toBeNull();
	});
	it('the rear caster hangs under the union of the left and right mounts on the ground line', () => {
		const a = rearCasterAnchor([rearLeft, rearRight], -29.8)!;
		expect(a.x).toBeCloseTo(0, 5);
		expect(a.topY).toBe(92);
		expect(a.z).toBeCloseTo(-662.5 + REAR_CASTER.plateFromRear, 5);
		expect(a.groundY).toBe(-29.8);
		expect(a.trail).toBe(REAR_CASTER.trail);
		// Kit and McMaster mounts occupy the same box, so either variant gives the same anchor.
		expect(rearCasterAnchor([rearLeft], -29.8)!.topY).toBe(92);
	});
	it('aabbUnion', () => {
		expect(aabbUnion([null, undefined])).toBeNull();
		expect(aabbUnion([mountR, mountL])).toEqual({
			min: [-193.5, -39.3, -141.6],
			max: [193.5, 17.2, -29.8]
		});
	});
});

describe('harness layout', () => {
	const seat: Aabb = { min: [-139, 226.4, -461.7], max: [139, 259.7, -246.7] };
	const back: Aabb = { min: [-137.3, 325.1, -478.1], max: [137.3, 549.8, -385.1] };
	const foot: Aabb = { min: [-138, 40, -220], max: [138, 99.9, 0] };

	it('two shoulder straps, a lap belt, a crotch strap and a strap per foot', () => {
		const l = harnessLayout({ seat, back, footrest: foot });
		const count = (n: string) => l.straps.filter((s) => s.name === n).length;
		expect([count('shoulder'), count('lap'), count('crotch'), count('foot')]).toEqual([2, 1, 1, 2]);
		expect(l.buckles.map((b) => b.name).sort()).toEqual(['chest', 'foot', 'foot', 'lap']);
	});
	it('without a footrest there are no foot straps', () => {
		const l = harnessLayout({ seat, back, footrest: null });
		expect(l.straps.some((s) => s.name === 'foot')).toBe(false);
	});
	it('shoulder straps are mirrored about x = 0 and meet at the chest buckle', () => {
		const l = harnessLayout({ seat, back, footrest: foot });
		const [a, b] = l.straps.filter((s) => s.name === 'shoulder');
		expect(a.points[0][0]).toBeCloseTo(-b.points[0][0], 6);
		const chest = l.buckles.find((x) => x.name === 'chest')!;
		const end = a.points[a.points.length - 1];
		expect(Math.abs(end[0])).toBeLessThan(25);
		expect(Math.abs(end[1] - chest.pos[1])).toBeLessThan(15);
	});
	it('every anchor stays inside the seat and back boxes plus the body offset', () => {
		const l = harnessLayout({ seat, back, footrest: foot });
		for (const s of l.straps.filter((x) => x.name !== 'foot'))
			for (const [x, y, z] of s.points) {
				expect(Math.abs(x)).toBeLessThanOrEqual(139);
				expect(y).toBeGreaterThan(seat.min[1] - 20);
				expect(y).toBeLessThan(back.max[1] + 40);
				expect(z).toBeGreaterThan(back.min[2] - 20);
				expect(z).toBeLessThanOrEqual(seat.max[2] + 5);
			}
		const lap = l.straps.find((s) => s.name === 'lap')!;
		expect(lap.points[0][0]).toBeCloseTo(-lap.points[lap.points.length - 1][0], 6);
	});
	it('foot straps sit on the footrest top', () => {
		const l = harnessLayout({ seat, back, footrest: foot });
		for (const s of l.straps.filter((x) => x.name === 'foot')) {
			expect(s.points[0][1]).toBeGreaterThan(foot.max[1]);
			expect(s.points[0][2]).toBeGreaterThan(foot.min[2]);
			expect(s.points[0][2]).toBeLessThan(foot.max[2]);
		}
	});
});
