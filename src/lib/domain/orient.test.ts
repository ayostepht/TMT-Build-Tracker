import { describe, expect, it } from 'vitest';
import { bounds, convexHull, minAreaRect, rotatePoints, type Pt } from './geom2d.ts';
import {
	applyPose,
	chooseOrientation,
	computePoses,
	convexHull3D,
	findOrientation,
	type Mesh3
} from './orient.ts';

/** Box with the lowest point at z = 0, centred in XY, outward counter-clockwise triangles. */
function box(w: number, d: number, h: number): Mesh3 {
	const x = w / 2;
	const y = d / 2;
	return {
		positions: [-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0, -x, -y, h, x, -y, h, x, y, h, -x, y, h],
		indices: [
			0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
			0, 4, 3, 4, 7
		]
	};
}

const bed256 = { usableX: 256, usableY: 256, maxH: 254 };

describe('minAreaRect (rotating calipers)', () => {
	it('finds the turn of a tilted rectangle', () => {
		const rect: Pt[] = [
			[-50, -10],
			[50, -10],
			[50, 10],
			[-50, 10]
		];
		const tilted = rotatePoints(rect, 0.6);
		const r = minAreaRect(convexHull(tilted));
		expect(r.w).toBeCloseTo(100, 6);
		expect(r.d).toBeCloseTo(20, 6);
		const b = bounds(rotatePoints(convexHull(tilted), r.angle));
		expect(b.w).toBeCloseTo(100, 6);
		expect(b.d).toBeCloseTo(20, 6);
	});

	it('matches a brute-force angle scan on random convex polygons', () => {
		let seed = 7;
		const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
		for (let k = 0; k < 25; k++) {
			const pts: Pt[] = Array.from({ length: 12 }, () => [rnd() * 200 - 100, rnd() * 80 - 40]);
			const hull = convexHull(rotatePoints(pts, rnd() * 3));
			const r = minAreaRect(hull);
			let best = Infinity;
			for (let a = 0; a < 180; a += 0.05) {
				const b = bounds(rotatePoints(hull, (a * Math.PI) / 180));
				best = Math.min(best, b.w * b.d);
			}
			expect(r.area).toBeLessThanOrEqual(best + 1e-6);
			expect(r.area).toBeGreaterThan(best * 0.98);
			expect(r.w).toBeGreaterThanOrEqual(r.d);
		}
	});

	it('degenerate input does not throw', () => {
		expect(minAreaRect([[0, 0]]).area).toBe(0);
		expect(
			minAreaRect([
				[0, 0],
				[10, 0]
			]).w
		).toBe(10);
	});
});

describe('convexHull3D', () => {
	it('hulls a cube with interior points to 12 triangles on 8 vertices', () => {
		const m = box(10, 20, 30);
		const pts = [...Array.from(m.positions), 5, 5, 5, 0, 0, 10, 1, 2, 3];
		const faces = convexHull3D(pts)!;
		expect(faces).toHaveLength(12);
		expect(new Set(faces.flat()).size).toBe(8);
	});
	it('every point lies inside a random point cloud hull', () => {
		let seed = 3;
		const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
		const pts: number[] = [];
		for (let i = 0; i < 400; i++) pts.push(rnd() * 100, rnd() * 60, rnd() * 20);
		const faces = convexHull3D(pts)!;
		for (const [a, b, c] of faces) {
			const p = (i: number) => [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
			const [pa, pb, pc] = [p(a), p(b), p(c)];
			const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
			const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
			const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
			for (let i = 0; i < 400; i++) {
				const dd =
					n[0] * (pts[i * 3] - pa[0]) +
					n[1] * (pts[i * 3 + 1] - pa[1]) +
					n[2] * (pts[i * 3 + 2] - pa[2]);
				expect(dd).toBeLessThan(1e-6 * Math.hypot(n[0], n[1], n[2]) * 100);
			}
		}
	});
	it('refuses flat input', () => {
		expect(convexHull3D([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 2, 2, 0])).toBeNull();
	});
});

describe('orientation search', () => {
	it('a 331 x 190 x 20 slab stands on its long edge to fit 256 x 256 x 256', () => {
		const slab = box(331, 190, 20);
		const r = findOrientation(slab, { w: 331, d: 190, h: 20 }, bed256);
		expect(r.fits).toBe(true);
		expect(r.reoriented).toBe(true);
		expect(r.height).toBeCloseTo(190, 0);
		expect(r.height).toBeLessThanOrEqual(254);
		// 331 x 20 footprint turned across the bed diagonal
		expect(r.footprint.w).toBeCloseTo(331, 0);
		expect(r.footprint.d).toBeCloseTo(20, 0);
		expect(r.contactArea).toBeCloseTo(331 * 20, 0);
		// applying the pose lands on z = 0 with the reported box
		const pos = slab.positions as number[];
		let zMin = Infinity;
		let zMax = -Infinity;
		const pts: Pt[] = [];
		for (let i = 0; i < pos.length; i += 3) {
			const q = applyPose(r.rotation, r.translation, [pos[i], pos[i + 1], pos[i + 2]]);
			zMin = Math.min(zMin, q[2]);
			zMax = Math.max(zMax, q[2]);
			pts.push([q[0], q[1]]);
		}
		expect(zMin).toBeCloseTo(0, 6);
		expect(zMax).toBeCloseTo(r.height, 1);
		const b = bounds(pts);
		expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 4);
		expect(b.w).toBeCloseTo(r.footprint.w, 0);
	});

	it('keeps the profile orientation when it fits (a cube)', () => {
		const r = findOrientation(box(40, 40, 40), { w: 40, d: 40, h: 40 }, bed256);
		expect(r.reoriented).toBe(false);
		expect(r.fits).toBe(true);
		expect(r.pose).toBeNull();
		expect(r.rotation).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
	});

	it('a part too big in every pose has no fit', () => {
		const r = findOrientation(box(400, 380, 390), { w: 400, d: 380, h: 390 }, bed256);
		expect(r.fits).toBe(false);
		expect(r.reoriented).toBe(false);
		expect(r.tried).toBeGreaterThan(1);
	});

	it('a bed height limit rules out tall poses', () => {
		const slab = box(331, 190, 20);
		const r = findOrientation(slab, { w: 331, d: 190, h: 20 }, { ...bed256, maxH: 100 });
		expect(r.fits).toBe(false);
	});

	it('is deterministic', () => {
		const a = computePoses(box(331, 190, 20));
		const b = computePoses(box(331, 190, 20));
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
		expect(a.poses.length).toBeGreaterThan(0);
		const c1 = chooseOrientation({ w: 331, d: 190, h: 20 }, a.poses, bed256);
		const c2 = chooseOrientation({ w: 331, d: 190, h: 20 }, b.poses, bed256);
		expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
	});

	it('prefers the larger resting area, then less support', () => {
		const slab = box(300, 200, 20);
		const { poses } = computePoses(slab);
		// bed 256 x 256: only edge poses fit; the 300 x 20 edge (6000 mm2) beats the 200 x 20 edge (4000 mm2)
		const r = chooseOrientation({ w: 300, d: 200, h: 20 }, poses, {
			usableX: 250,
			usableY: 250,
			maxH: 400
		});
		expect(r.reoriented).toBe(true);
		expect(r.contactArea).toBeCloseTo(6000, 0);
	});
});
