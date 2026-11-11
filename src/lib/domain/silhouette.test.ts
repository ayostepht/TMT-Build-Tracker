import { describe, expect, it } from 'vitest';
import {
	computePieceSilhouettes,
	computeSilhouette,
	edgeColor,
	luminance,
	placeRings,
	ringArea,
	ringsToPath,
	roundedRectPath,
	type SilMesh
} from './silhouette.ts';

/** A flat plate (z = 0..2) of w x d centred on the origin with an optional rectangular hole. */
function plate(w: number, d: number, hole?: { w: number; d: number }): SilMesh {
	const pos: number[] = [];
	const idx: number[] = [];
	const v = (x: number, y: number, z: number) => {
		pos.push(x, y, z);
		return pos.length / 3 - 1;
	};
	const quad = (x0: number, y0: number, x1: number, y1: number) => {
		const a = v(x0, y0, 2);
		const b = v(x1, y0, 2);
		const c = v(x1, y1, 2);
		const e = v(x0, y1, 2);
		idx.push(a, b, c, a, c, e);
	};
	const X = w / 2;
	const Y = d / 2;
	if (!hole) quad(-X, -Y, X, Y);
	else {
		const hx = hole.w / 2;
		const hy = hole.d / 2;
		quad(-X, -Y, X, -hy); // bottom strip
		quad(-X, hy, X, Y); // top strip
		quad(-X, -hy, -hx, hy); // left
		quad(hx, -hy, X, hy); // right
	}
	return { positions: pos, indices: idx };
}

/** A fan disc with many vertices (a "round" part from a dense mesh). */
function disc(r: number, n = 4000): SilMesh {
	const pos: number[] = [0, 0, 0];
	const idx: number[] = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
	}
	for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
	return { positions: pos, indices: idx };
}

describe('computeSilhouette', () => {
	it('outlines a rectangle with the right size and winding', () => {
		const s = computeSilhouette(plate(40, 20))!;
		expect(s.rings).toHaveLength(1);
		expect(ringArea(s.rings[0])).toBeGreaterThan(0); // outer rings are counter-clockwise
		expect(Math.abs(ringArea(s.rings[0]) - 800)).toBeLessThan(800 * 0.05);
		const xs = s.rings[0].map((p) => p[0]);
		expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(39);
		expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(41);
		// four corners, not a staircase
		expect(s.rings[0].length).toBeLessThanOrEqual(12);
	});

	it('keeps holes as clockwise rings', () => {
		const s = computeSilhouette(plate(40, 40, { w: 12, d: 12 }))!;
		expect(s.rings).toHaveLength(2);
		const [outer, hole] = s.rings;
		expect(ringArea(outer)).toBeGreaterThan(0);
		expect(ringArea(hole)).toBeLessThan(0);
		expect(Math.abs(Math.abs(ringArea(hole)) - 144)).toBeLessThan(144 * 0.15);
	});

	it('puts the pole of inaccessibility in the thick part, not the hole', () => {
		// a C: wide plate with the hole offset so the thickest material is on the right
		const mesh = plate(60, 30, { w: 20, d: 10 });
		const s = computeSilhouette(mesh)!;
		expect(s.r).toBeGreaterThan(4);
		// not inside the hole (|x| < 10 and |y| < 5)
		expect(Math.abs(s.pole[0]) > 9.5 || Math.abs(s.pole[1]) > 4.5).toBe(true);
	});

	it('caps the number of points', () => {
		const s = computeSilhouette(disc(60), { maxPoints: 200 })!;
		const n = s.rings.reduce((a, r) => a + r.length, 0);
		expect(n).toBeLessThanOrEqual(200);
		expect(n).toBeGreaterThan(12);
		expect(Math.abs(ringArea(s.rings[0]) - Math.PI * 3600)).toBeLessThan(Math.PI * 3600 * 0.05);
	});

	it('returns null for an empty mesh', () => {
		expect(computeSilhouette({ positions: [], indices: [] })).toBeNull();
	});

	it('computes the profile outline of a piece', () => {
		const res = computePieceSilhouettes(plate(30, 30))!;
		expect(res.profile.rings.length).toBe(1);
		expect('poses' in res).toBe(false);
	});
});

describe('drawing helpers', () => {
	it('places rings by rotation then translation', () => {
		const [r] = placeRings([[[10, 0]]], 90, 5, 5);
		expect(r[0][0]).toBeCloseTo(5);
		expect(r[0][1]).toBeCloseTo(15);
	});

	it('writes closed path data with y flipped to the bed top', () => {
		expect(
			ringsToPath(
				[
					[
						[0, 0],
						[10, 0],
						[10, 10]
					]
				],
				100
			)
		).toBe('M0 100L10 100L10 90Z');
	});

	it('draws a rounded rectangle within its box', () => {
		const d = roundedRectPath(50, 50, 20, 10);
		expect(d.startsWith('M')).toBe(true);
		expect(d.endsWith('Z')).toBe(true);
		expect(d).toContain('Q');
	});
});

describe('edge colors', () => {
	it('darkens normal filaments', () => {
		expect(luminance(edgeColor('#e53935'))).toBeLessThan(luminance('#e53935'));
	});
	it('lightens very dark filaments so they read on the bed', () => {
		expect(luminance('#111111')).toBeLessThan(0.12);
		expect(luminance(edgeColor('#111111'))).toBeGreaterThan(luminance('#111111') + 0.1);
	});
	it('survives garbage', () => {
		expect(edgeColor('not a color')).toMatch(/^#/);
	});
});
