import { describe, expect, it } from 'vitest';
import {
	bounds,
	convexHull,
	minAreaAngle,
	polygonArea,
	rotatePoints,
	simplifyHull,
	type Pt
} from './geom2d.ts';

const circle = (n: number, r: number): Pt[] =>
	Array.from({ length: n }, (_, i) => [
		r * Math.cos((2 * Math.PI * i) / n),
		r * Math.sin((2 * Math.PI * i) / n)
	]);

describe('geom2d', () => {
	it('convex hull drops interior points', () => {
		const h = convexHull([
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10],
			[5, 5],
			[5, 0]
		]);
		expect(h).toHaveLength(4);
		expect(polygonArea(h)).toBeCloseTo(100);
	});

	it('finds the angle that straightens a tilted rectangle', () => {
		const rect: Pt[] = [
			[-100, -10],
			[100, -10],
			[100, 10],
			[-100, 10]
		];
		const tilted = rotatePoints(rect, (30 * Math.PI) / 180);
		const a = minAreaAngle(convexHull(tilted));
		const b = bounds(rotatePoints(tilted, a));
		expect(b.w).toBeCloseTo(200, 0);
		expect(b.d).toBeCloseTo(20, 0);
	});

	it('keeps the as-placed axes when a tilt barely helps', () => {
		const circ = convexHull(circle(64, 50));
		expect(minAreaAngle(circ) % (Math.PI / 2)).toBeCloseTo(0);
	});

	it('simplified hulls still contain the original', () => {
		const hull = convexHull(circle(200, 100));
		const s = simplifyHull(hull, 16);
		expect(s.length).toBeLessThanOrEqual(16);
		expect(polygonArea(s)).toBeGreaterThanOrEqual(polygonArea(hull) - 1e-6);
		for (const p of hull) {
			let minD = Infinity;
			for (let i = 0; i < s.length; i++) {
				const a = s[i];
				const b = s[(i + 1) % s.length];
				const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
				minD = Math.min(minD, ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / l);
			}
			expect(minD).toBeGreaterThanOrEqual(-1e-6);
		}
	});
});
