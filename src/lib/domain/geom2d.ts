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

const EPS = 1e-6;
const dedupeAngle = (a: number) => (((Math.round(a * 10) / 10) % 360) + 360) % 360;
/**
 * Placement candidates for one piece: the box as printed and turned 90 degrees. When
 * neither fits the empty bed and the piece has an outline, free angles whose rotated
 * bounding box does fit are offered instead (tightest first, at most 6): long thin parts
 * go diagonally. Exported for tests.
 */
export function boxOrients(
	pc: { w: number; d: number; hull?: Pt[] },
	rotate: boolean,
	usableX: number,
	usableY: number
): { w: number; d: number; rot: number; ox?: number; oy?: number }[] {
	const base: { w: number; d: number; rot: number; ox?: number; oy?: number }[] = [
		{ w: pc.w, d: pc.d, rot: 0 }
	];
	if (rotate && Math.abs(pc.w - pc.d) > EPS) base.push({ w: pc.d, d: pc.w, rot: 90 });
	const fits = (o: { w: number; d: number }) => o.w <= usableX + EPS && o.d <= usableY + EPS;
	if (!rotate || base.some(fits)) return base;
	const outline: Pt[] = pc.hull?.length
		? pc.hull
		: [
				[-pc.w / 2, -pc.d / 2],
				[pc.w / 2, -pc.d / 2],
				[pc.w / 2, pc.d / 2],
				[-pc.w / 2, pc.d / 2]
			];
	const angles = new Set<number>();
	for (let deg = 0; deg < 180; deg++) angles.add(deg);
	for (let i = 0; i < outline.length; i++) {
		const p = outline[i];
		const q = outline[(i + 1) % outline.length];
		const deg = (-Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
		angles.add(dedupeAngle(deg) % 180);
	}
	const found: { w: number; d: number; rot: number; ox?: number; oy?: number }[] = [];
	for (const deg of angles) {
		const b = bounds(rotatePoints(outline, (deg * Math.PI) / 180));
		const w = Math.round((b.w + 0.05) * 10) / 10;
		const d = Math.round((b.d + 0.05) * 10) / 10;
		// the rotated outline is not centred on the origin: offset of its box centre, to be removed when placing
		const cx = Math.round(((b.minX + b.maxX) / 2) * 100) / 100;
		const cy = Math.round(((b.minY + b.maxY) / 2) * 100) / 100;
		if (fits({ w, d })) found.push({ w, d, rot: deg, ox: cx, oy: cy });
		if (fits({ w: d, d: w })) found.push({ w: d, d: w, rot: (deg + 90) % 360, ox: -cy, oy: cx });
	}
	found.sort((x, y) => x.w * x.d - y.w * y.d || x.rot - y.rot);
	return found.slice(0, 6);
}

/**
 * Minimum-area bounding rectangle of a convex polygon (counter-clockwise) by rotating
 * calipers: O(n) after the first edge. Returns the counter-clockwise angle (radians) to
 * rotate the polygon by so the rectangle is axis aligned with `w >= d`, its size and area.
 * Ties prefer the smaller turn.
 */
export function minAreaRect(hull: readonly Pt[]): {
	angle: number;
	w: number;
	d: number;
	area: number;
} {
	const n = hull.length;
	if (n < 3) {
		const b = bounds(hull);
		return b.d > b.w
			? { angle: Math.PI / 2, w: b.d, d: b.w, area: b.w * b.d }
			: { angle: 0, w: b.w, d: b.d, area: b.w * b.d };
	}
	const dot = (a: Pt, ux: number, uy: number) => a[0] * ux + a[1] * uy;
	let best: { angle: number; w: number; d: number; area: number } | null = null;
	let bestNorm = Infinity;
	let r = 0;
	let t = 0;
	let l = 0;
	for (let i = 0; i < n; i++) {
		const p = hull[i];
		const q = hull[(i + 1) % n];
		const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
		if (len < 1e-12) continue;
		const ux = (q[0] - p[0]) / len;
		const uy = (q[1] - p[1]) / len;
		const vx = -uy;
		const vy = ux;
		if (i === 0 || best === null) {
			// first usable edge: find the extremes by scanning
			r = t = l = 0;
			for (let k = 1; k < n; k++) {
				if (dot(hull[k], ux, uy) > dot(hull[r], ux, uy)) r = k;
				if (dot(hull[k], vx, vy) > dot(hull[t], vx, vy)) t = k;
				if (dot(hull[k], ux, uy) < dot(hull[l], ux, uy)) l = k;
			}
		} else {
			let guard = 0;
			while (guard++ < n && dot(hull[(r + 1) % n], ux, uy) > dot(hull[r], ux, uy) + 1e-12)
				r = (r + 1) % n;
			guard = 0;
			while (guard++ < n && dot(hull[(t + 1) % n], vx, vy) > dot(hull[t], vx, vy) + 1e-12)
				t = (t + 1) % n;
			guard = 0;
			while (guard++ < n && dot(hull[(l + 1) % n], ux, uy) < dot(hull[l], ux, uy) - 1e-12)
				l = (l + 1) % n;
		}
		const width = dot(hull[r], ux, uy) - dot(hull[l], ux, uy);
		const height = dot(hull[t], vx, vy) - dot(p, vx, vy);
		const area = width * height;
		let angle = -Math.atan2(uy, ux);
		let w = width;
		let d = height;
		if (d > w) {
			[w, d] = [d, w];
			angle += Math.PI / 2;
		}
		let x = ((angle % Math.PI) + Math.PI) % Math.PI;
		if (x > Math.PI / 2) x = Math.PI - x;
		if (!best || area < best.area - 1e-6 || (Math.abs(area - best.area) <= 1e-6 && x < bestNorm)) {
			best = { angle, w, d, area };
			bestNorm = x;
		}
	}
	return best ?? { angle: 0, w: 0, d: 0, area: 0 };
}
