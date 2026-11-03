/**
 * Small 2D geometry helpers for print footprints: convex hull, polygon area,
 * minimum-area bounding rectangle and hull simplification. Pure, no imports.
 * Points are `[x, y]` in mm.
 */
export type Pt = [number, number];

const cross = (o: Pt, a: Pt, b: Pt) =>
	(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull (Andrew's monotone chain), counter-clockwise, no repeated first point. */
export function convexHull(points: readonly Pt[]): Pt[] {
	const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const uniq: Pt[] = [];
	for (const p of pts) {
		const last = uniq[uniq.length - 1];
		if (!last || last[0] !== p[0] || last[1] !== p[1]) uniq.push(p);
	}
	if (uniq.length <= 2) return uniq;
	const lower: Pt[] = [];
	for (const p of uniq) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
			lower.pop();
		lower.push(p);
	}
	const upper: Pt[] = [];
	for (let i = uniq.length - 1; i >= 0; i--) {
		const p = uniq[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
			upper.pop();
		upper.push(p);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

/** Absolute polygon area (shoelace). */
export function polygonArea(poly: readonly Pt[]): number {
	let a = 0;
	for (let i = 0; i < poly.length; i++) {
		const p = poly[i];
		const q = poly[(i + 1) % poly.length];
		a += p[0] * q[1] - q[0] * p[1];
	}
	return Math.abs(a) / 2;
}

export function bounds(points: readonly Pt[]) {
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const [x, y] of points) {
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	return { minX, minY, maxX, maxY, w: maxX - minX, d: maxY - minY };
}

/** Rotate points counter-clockwise by `rad` about the origin. */
export function rotatePoints(points: readonly Pt[], rad: number): Pt[] {
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	return points.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

/**
 * Angle (radians, counter-clockwise) to rotate a convex polygon by so its
 * axis-aligned bounding box has minimum area; ties and near-ties prefer the
 * smaller rotation. Rotated result has width >= depth. Rotating calipers over
 * the hull edges (the optimum is always flush with an edge).
 */
export function minAreaAngle(hull: readonly Pt[]): number {
	if (hull.length < 3) return 0;
	let best = 0;
	let bestArea = Infinity;
	let bestNorm = Infinity;
	const norm = (a: number) => {
		let x = ((a % Math.PI) + Math.PI) % Math.PI;
		if (x > Math.PI / 2) x = Math.PI - x;
		return x;
	};
	const tryAngle = (theta: number) => {
		const b = bounds(rotatePoints(hull, theta));
		const area = b.w * b.d;
		const n = norm(theta);
		if (area < bestArea - 1e-6 || (Math.abs(area - bestArea) <= 1e-6 && n < bestNorm)) {
			bestArea = area;
			bestNorm = n;
			best = theta;
		}
	};
	tryAngle(0);
	for (let i = 0; i < hull.length; i++) {
		const p = hull[i];
		const q = hull[(i + 1) % hull.length];
		const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
		if (len < 1e-9) continue;
		tryAngle(-Math.atan2(q[1] - p[1], q[0] - p[0]));
	}
	// only accept a tilt that clearly pays off (>= 0.5 % smaller box); else keep the as-placed axes
	const b0 = bounds(hull);
	const area0 = b0.w * b0.d;
	if (best !== 0 && bestArea > area0 * 0.995) best = 0;
	const r = bounds(rotatePoints(hull, best));
	return r.d > r.w ? best + Math.PI / 2 : best;
}

/**
 * Reduce a convex polygon to at most `max` vertices by repeatedly dropping the
 * vertex whose removal loses the least area, then offsetting the kept edges
 * outward by the largest gap so the result still contains the original.
 */
export function simplifyHull(hull: readonly Pt[], max = 24): Pt[] {
	let pts = hull.map((p) => [...p] as Pt);
	while (pts.length > max) {
		let bestI = 0;
		let bestLoss = Infinity;
		for (let i = 0; i < pts.length; i++) {
			const a = pts[(i + pts.length - 1) % pts.length];
			const b = pts[i];
			const c = pts[(i + 1) % pts.length];
			const loss = Math.abs(cross(a, b, c)) / 2;
			if (loss < bestLoss) {
				bestLoss = loss;
				bestI = i;
			}
		}
		pts = pts.filter((_, i) => i !== bestI);
	}
	if (pts.length === hull.length) return pts;
	// how far the dropped vertices stick out of the simplified polygon (counter-clockwise)
	let growth = 0;
	for (const h of hull) {
		let inside = Infinity;
		for (let i = 0; i < pts.length; i++) {
			const a = pts[i];
			const b = pts[(i + 1) % pts.length];
			const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
			inside = Math.min(inside, cross(a, b, h) / len);
		}
		if (inside < 0) growth = Math.max(growth, -inside);
	}
	if (growth <= 0) return pts;
	const n = pts.length;
	const normal = (a: Pt, b: Pt): Pt => {
		const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; // outward for counter-clockwise polygons
	};
	return pts.map((v, i) => {
		const n1 = normal(pts[(i + n - 1) % n], v);
		const n2 = normal(v, pts[(i + 1) % n]);
		const k = growth / Math.max(0.3, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
		return [v[0] + (n1[0] + n2[0]) * k, v[1] + (n1[1] + n2[1]) * k] as Pt;
	});
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
