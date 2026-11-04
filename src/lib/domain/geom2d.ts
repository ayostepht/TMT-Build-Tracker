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
const SWEEP_STEP = 0.5;

export interface BoxOrient {
	w: number;
	d: number;
	rot: number;
	ox?: number;
	oy?: number;
}

/** The part of a piece's geometry the fitter looks at (outlines are around the box centre). */
export interface FitPiece {
	w: number;
	d: number;
	hull?: Pt[];
	/** True top-down outline (`PrintPiece.sil`); only `profile.rings` is read. */
	sil?: { profile?: { rings: Pt[][] } };
}

const ringSigned = (ring: readonly Pt[]) => {
	let a = 0;
	for (let i = 0; i < ring.length; i++) {
		const p = ring[i];
		const q = ring[(i + 1) % ring.length];
		a += p[0] * q[1] - q[0] * p[1];
	}
	return a / 2;
};

/**
 * The outline a piece is fitted by: the outer rings of its silhouette (holes cannot change the
 * bounding box), else its convex hull, else the box. Reduced to the convex hull of those points,
 * which has the same bounding box at every angle.
 */
export function fitOutline(pc: FitPiece): Pt[] {
	const rings = pc.sil?.profile?.rings;
	if (rings?.length) {
		const pts: Pt[] = [];
		for (const r of rings) if (r.length >= 3 && ringSigned(r) > 0) pts.push(...r);
		if (pts.length >= 3) return convexHull(pts);
	}
	if (pc.hull && pc.hull.length >= 3) return pc.hull;
	return [
		[-pc.w / 2, -pc.d / 2],
		[pc.w / 2, -pc.d / 2],
		[pc.w / 2, pc.d / 2],
		[-pc.w / 2, pc.d / 2]
	];
}

/** Bounding box of the outline turned by `deg` degrees counter-clockwise. */
function turnedBox(outline: readonly Pt[], deg: number) {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const [x, y] of outline) {
		const X = x * c - y * s;
		const Y = x * s + y * c;
		if (X < minX) minX = X;
		if (X > maxX) maxX = X;
		if (Y < minY) minY = Y;
		if (Y > maxY) maxY = Y;
	}
	return { w: maxX - minX, d: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

const ceil1 = (n: number) => Math.ceil(n * 10 - 1e-9) / 10;
const norm360 = (d: number) => ((d % 360) + 360) % 360;

/**
 * Placement candidates for one piece: the box as printed and turned 90 degrees. When
 * neither fits the empty bed, the piece's true outline (silhouette, else hull, else box)
 * is turned about z over a fine sweep (0.5 degrees) and refined around each local best;
 * angles whose turned outline box fits are offered, largest clearance first (at most 6).
 * Long or cut-corner parts go diagonally. Flat rotations only. Exported for tests.
 */
export function boxOrients(
	pc: FitPiece,
	rotate: boolean,
	usableX: number,
	usableY: number
): BoxOrient[] {
	const base: BoxOrient[] = [{ w: pc.w, d: pc.d, rot: 0 }];
	if (rotate && Math.abs(pc.w - pc.d) > EPS) base.push({ w: pc.d, d: pc.w, rot: 90 });
	const fits = (o: { w: number; d: number }) => o.w <= usableX + EPS && o.d <= usableY + EPS;
	if (!rotate || base.some(fits)) return base;
	const outline = fitOutline(pc);
	const clearance = (deg: number) => {
		const b = turnedBox(outline, deg);
		return Math.min(usableX - b.w, usableY - b.d);
	};
	const n = Math.round(360 / SWEEP_STEP);
	const cl: number[] = [];
	for (let i = 0; i < n; i++) cl.push(clearance(i * SWEEP_STEP));
	// local maxima of the clearance, best first (ties: smaller angle)
	const peaks: number[] = [];
	for (let i = 0; i < n; i++)
		if (cl[i] >= cl[(i + n - 1) % n] && cl[i] > cl[(i + 1) % n]) peaks.push(i);
	peaks.sort((a, b) => cl[b] - cl[a] || a - b);
	const found: (BoxOrient & { clr: number })[] = [];
	const g = (Math.sqrt(5) - 1) / 2;
	for (const i of peaks.slice(0, 8)) {
		if (cl[i] < -2) break;
		// golden-section search for the clearance maximum within one step either side
		let lo = i * SWEEP_STEP - SWEEP_STEP;
		let hi = i * SWEEP_STEP + SWEEP_STEP;
		let x1 = hi - g * (hi - lo);
		let x2 = lo + g * (hi - lo);
		let f1 = clearance(x1);
		let f2 = clearance(x2);
		for (let k = 0; k < 24; k++) {
			if (f1 < f2) {
				lo = x1;
				x1 = x2;
				f1 = f2;
				x2 = lo + g * (hi - lo);
				f2 = clearance(x2);
			} else {
				hi = x2;
				x2 = x1;
				f2 = f1;
				x1 = hi - g * (hi - lo);
				f1 = clearance(x1);
			}
		}
		let deg = Math.round(norm360((lo + hi) / 2) * 100) / 100;
		if (clearance(i * SWEEP_STEP) > clearance(deg)) deg = i * SWEEP_STEP;
		const b = turnedBox(outline, deg);
		const w = ceil1(b.w);
		const d = ceil1(b.d);
		if (!fits({ w, d })) continue;
		if (found.some((f) => Math.abs(f.rot - deg) < 1e-9)) continue;
		found.push({
			w,
			d,
			rot: deg,
			ox: Math.round(b.cx * 100) / 100,
			oy: Math.round(b.cy * 100) / 100,
			clr: Math.min(usableX - w, usableY - d)
		});
	}
	// more candidates for packing: the tightest other feasible angles (at least 5 degrees apart)
	if (found.length < 6) {
		const extra: { i: number; a: number }[] = [];
		for (let i = 0; i < n; i++)
			if (cl[i] >= 0) {
				const b = turnedBox(outline, i * SWEEP_STEP);
				extra.push({ i, a: b.w * b.d });
			}
		extra.sort((p, q) => p.a - q.a || p.i - q.i);
		for (const { i } of extra) {
			if (found.length >= 6) break;
			const deg = i * SWEEP_STEP;
			if (found.some((f) => Math.min(Math.abs(f.rot - deg), 360 - Math.abs(f.rot - deg)) < 5))
				continue;
			const b = turnedBox(outline, deg);
			const w = ceil1(b.w);
			const d = ceil1(b.d);
			if (!fits({ w, d })) continue;
			found.push({
				w,
				d,
				rot: deg,
				ox: Math.round(b.cx * 100) / 100,
				oy: Math.round(b.cy * 100) / 100,
				clr: -1e9
			});
		}
	}
	found.sort((x, y) => y.clr - x.clr || x.rot - y.rot);
	return found.slice(0, 6).map((f) => ({ w: f.w, d: f.d, rot: f.rot, ox: f.ox, oy: f.oy }));
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

/**
 * Distance between two convex polygons (counter-clockwise, at least 3 points each): 0 when
 * they touch, a negative number when they overlap. Separating-axis test first, then the
 * closest vertex-to-edge distance.
 */
export function polygonDistance(a: readonly Pt[], b: readonly Pt[]): number {
	const separated = (p: readonly Pt[], q: readonly Pt[]) => {
		for (let i = 0; i < p.length; i++) {
			const u = p[i];
			const v = p[(i + 1) % p.length];
			let allOut = true;
			for (const w of q)
				if (cross(u, v, w) > 0) {
					allOut = false;
					break;
				}
			if (allOut) return true; // every point of q is on the right of edge u->v (outside, CCW)
		}
		return false;
	};
	if (!separated(a, b) && !separated(b, a)) return -1;
	const segDist = (p: Pt, u: Pt, v: Pt) => {
		const dx = v[0] - u[0];
		const dy = v[1] - u[1];
		const l2 = dx * dx + dy * dy;
		let t = l2 ? ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / l2 : 0;
		t = Math.max(0, Math.min(1, t));
		const ex = p[0] - (u[0] + t * dx);
		const ey = p[1] - (u[1] + t * dy);
		return ex * ex + ey * ey;
	};
	let best = Infinity;
	for (const p of a)
		for (let j = 0; j < b.length; j++)
			best = Math.min(best, segDist(p, b[j], b[(j + 1) % b.length]));
	for (const p of b)
		for (let j = 0; j < a.length; j++)
			best = Math.min(best, segDist(p, a[j], a[(j + 1) % a.length]));
	return Math.sqrt(best);
}

/** Corner points of an axis-aligned rectangle, counter-clockwise. */
export const rectPoly = (x: number, y: number, w: number, d: number): Pt[] => [
	[x, y],
	[x + w, y],
	[x + w, y + d],
	[x, y + d]
];

/** Bounding box of an outline turned by `deg` degrees (centre and size): shared with the fitter. */
export function turnedOutlineBox(outline: readonly Pt[], deg: number) {
	return turnedBox(outline, deg);
}
