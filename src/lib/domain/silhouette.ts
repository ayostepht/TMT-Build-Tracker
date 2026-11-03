/**
 * True top-down outline of a printed piece, for the plate diagrams. Pure and
 * framework-free (no DB, Node or Svelte).
 *
 * The mesh triangles (after the pose rotation, if any) are projected to XY and rasterised
 * into a bitmap at ~0.6 mm. The bitmap is blurred a little and contoured with marching
 * squares, which gives smooth outer contours and holes (pockets, openings). The contours are
 * simplified (Douglas-Peucker, ~0.5 mm) and capped to a point budget. The result is kept per
 * piece and per pose in the print-geometry footprint json (`PrintPiece.sil`), in the same
 * frame as `PrintPiece.hull`: around the box centre, before `ArrangedItem.rotation`.
 *
 * Rings follow the "inside on the left" rule: outer contours turn counter-clockwise (positive
 * area), holes clockwise. Drawing with `fill-rule="evenodd"` needs neither.
 */
import type { Pt } from './geom2d.ts';

export const SIL_VERSION = 1;

/** One outline: outer contours and holes, plus the most "inside" point for labels. */
export interface Silhouette {
	/** Closed rings (first point not repeated), mm, one decimal. Outer rings CCW, holes CW. */
	rings: Pt[][];
	/** Pole of inaccessibility: the point farthest from any edge (largest inscribed circle), mm. */
	pole: Pt;
	/** Radius of that inscribed circle, mm. */
	r: number;
}

/** Stored per piece (`PrintPiece.sil`); `poses[i]` belongs to `PrintPiece.orient.poses[i]`. */
export interface PieceSilhouettes {
	v: number;
	profile: Silhouette;
	poses: Silhouette[];
}

export interface SilMesh {
	positions: ArrayLike<number>;
	indices: ArrayLike<number>;
}

export interface SilOptions {
	/** Raster cell size, mm. Default 0.6 (grows for huge parts to keep the bitmap under ~1000 cells a side). */
	res?: number;
	/** Douglas-Peucker tolerance, mm. Default 0.5. */
	tol?: number;
	/** Point budget over all rings. Default 200. */
	maxPoints?: number;
	/** Rings smaller than this (mm2) are dropped: specks. Default 2. */
	minArea?: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Signed shoelace area (positive for counter-clockwise rings). */
export function ringArea(ring: readonly Pt[]): number {
	let a = 0;
	for (let i = 0; i < ring.length; i++) {
		const p = ring[i];
		const q = ring[(i + 1) % ring.length];
		a += p[0] * q[1] - q[0] * p[1];
	}
	return a / 2;
}

function distToSeg(p: Pt, a: Pt, b: Pt): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const l2 = dx * dx + dy * dy;
	let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker on an open polyline (first and last point stay). */
function dpOpen(pts: readonly Pt[], tol: number): Pt[] {
	const n = pts.length;
	if (n <= 2) return pts.slice();
	const keep = new Uint8Array(n);
	keep[0] = keep[n - 1] = 1;
	const stack: [number, number][] = [[0, n - 1]];
	while (stack.length) {
		const [s, e] = stack.pop()!;
		let best = -1;
		let bd = tol;
		for (let i = s + 1; i < e; i++) {
			const d = distToSeg(pts[i], pts[s], pts[e]);
			if (d > bd) {
				bd = d;
				best = i;
			}
		}
		if (best >= 0) {
			keep[best] = 1;
			stack.push([s, best], [best, e]);
		}
	}
	return pts.filter((_, i) => keep[i]);
}

/** Douglas-Peucker on a closed ring: split at the point farthest from the first one. */
export function simplifyRing(ring: readonly Pt[], tol: number): Pt[] {
	const n = ring.length;
	if (n <= 4) return ring.map((p) => [...p] as Pt);
	let far = 0;
	let fd = -1;
	for (let i = 1; i < n; i++) {
		const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
		if (d > fd) {
			fd = d;
			far = i;
		}
	}
	const a = dpOpen(ring.slice(0, far + 1), tol);
	const b = dpOpen([...ring.slice(far), ring[0]], tol);
	return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Mark the cells a triangle covers (cell centres inside it; thin ones also along their edges). */
function fillTriangle(
	bits: Uint8Array,
	W: number,
	H: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number
) {
	const area2 = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
	const maxEdge = Math.max(
		Math.hypot(bx - ax, by - ay),
		Math.hypot(cx - bx, cy - by),
		Math.hypot(ax - cx, ay - cy)
	);
	// thin (a vertical wall projects to a line): trace the edges so it still leaves a mark
	if (area2 < 2 || (maxEdge > 0 && area2 / maxEdge < 1)) {
		const edge = (px: number, py: number, qx: number, qy: number) => {
			const steps = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py) * 2));
			for (let s = 0; s <= steps; s++) {
				const t = s / steps;
				const i = Math.floor(px + (qx - px) * t);
				const j = Math.floor(py + (qy - py) * t);
				if (i >= 0 && i < W && j >= 0 && j < H) bits[j * W + i] = 1;
			}
		};
		edge(ax, ay, bx, by);
		edge(bx, by, cx, cy);
		edge(cx, cy, ax, ay);
		if (area2 < 2) return;
	}
	const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5));
	const j1 = Math.min(H - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
	for (let j = j0; j <= j1; j++) {
		const y = j + 0.5;
		let lo = Infinity;
		let hi = -Infinity;
		const cross = (px: number, py: number, qx: number, qy: number) => {
			if ((py <= y && qy > y) || (qy <= y && py > y)) {
				const x = px + ((y - py) / (qy - py)) * (qx - px);
				if (x < lo) lo = x;
				if (x > hi) hi = x;
			}
		};
		cross(ax, ay, bx, by);
		cross(bx, by, cx, cy);
		cross(cx, cy, ax, ay);
		if (lo > hi) continue;
		const i0 = Math.max(0, Math.ceil(lo - 0.5));
		const i1 = Math.min(W - 1, Math.floor(hi - 0.5));
		for (let i = i0; i <= i1; i++) bits[j * W + i] = 1;
	}
}

/** Euclidean-ish distance (cells) to the nearest empty cell, two-pass chamfer. */
function distanceField(bits: Uint8Array, W: number, H: number): Float32Array {
	const d = new Float32Array(W * H);
	const BIG = 1e6;
	const S2 = Math.SQRT2;
	for (let j = 0; j < H; j++)
		for (let i = 0; i < W; i++) {
			const k = j * W + i;
			if (!bits[k]) continue;
			let v: number;
			if (i === 0 || j === 0) v = 1;
			else {
				v = Math.min(
					d[k - 1] + 1,
					d[k - W] + 1,
					d[k - W - 1] + S2,
					i + 1 < W ? d[k - W + 1] + S2 : BIG
				);
			}
			d[k] = v;
		}
	for (let j = H - 1; j >= 0; j--)
		for (let i = W - 1; i >= 0; i--) {
			const k = j * W + i;
			if (!bits[k]) continue;
			let v = d[k];
			if (i === W - 1 || j === H - 1) v = Math.min(v, 1);
			else {
				v = Math.min(
					v,
					d[k + 1] + 1,
					d[k + W] + 1,
					d[k + W + 1] + S2,
					i > 0 ? d[k + W - 1] + S2 : BIG
				);
			}
			d[k] = v;
		}
	return d;
}

/**
 * Outline of the mesh seen from above. `xf` (a pose: row-major 3x3 `m`, translation `t`) is
 * applied first; without it the mesh is used as stored. Returns null for an empty mesh.
 */
export function computeSilhouette(
	mesh: SilMesh,
	xf?: { m: readonly number[]; t: readonly number[] } | null,
	opts: SilOptions = {}
): Silhouette | null {
	const nv = Math.floor(mesh.positions.length / 3);
	const nt = Math.floor(mesh.indices.length / 3);
	if (nv < 3 || nt < 1) return null;
	const px = new Float64Array(nv);
	const py = new Float64Array(nv);
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (let i = 0; i < nv; i++) {
		const x = mesh.positions[i * 3];
		const y = mesh.positions[i * 3 + 1];
		const z = mesh.positions[i * 3 + 2];
		const X = xf ? xf.m[0] * x + xf.m[1] * y + xf.m[2] * z + xf.t[0] : x;
		const Y = xf ? xf.m[3] * x + xf.m[4] * y + xf.m[5] * z + xf.t[1] : y;
		px[i] = X;
		py[i] = Y;
		if (X < minX) minX = X;
		if (X > maxX) maxX = X;
		if (Y < minY) minY = Y;
		if (Y > maxY) maxY = Y;
	}
	if (!(maxX > minX) || !(maxY > minY)) return null;
	const res = Math.max(opts.res ?? 0.6, Math.max(maxX - minX, maxY - minY) / 1000);
	const tol0 = opts.tol ?? 0.5;
	const maxPoints = opts.maxPoints ?? 200;
	const minArea = opts.minArea ?? 2;
	const PAD = 3;
	const W = Math.ceil((maxX - minX) / res) + 2 * PAD;
	const H = Math.ceil((maxY - minY) / res) + 2 * PAD;
	const ox = minX - PAD * res;
	const oy = minY - PAD * res;
	const bits = new Uint8Array(W * H);
	for (let t = 0; t < nt; t++) {
		const a = mesh.indices[t * 3];
		const b = mesh.indices[t * 3 + 1];
		const c = mesh.indices[t * 3 + 2];
		fillTriangle(
			bits,
			W,
			H,
			(px[a] - ox) / res,
			(py[a] - oy) / res,
			(px[b] - ox) / res,
			(py[b] - oy) / res,
			(px[c] - ox) / res,
			(py[c] - oy) / res
		);
	}

	// pole of inaccessibility from the distance field
	const dist = distanceField(bits, W, H);
	let bk = 0;
	let bd = -1;
	for (let k = 0; k < dist.length; k++) {
		if (dist[k] > bd) {
			bd = dist[k];
			bk = k;
		}
	}
	if (bd <= 0) return null;
	const pole: Pt = [r1(ox + ((bk % W) + 0.5) * res), r1(oy + (Math.floor(bk / W) + 0.5) * res)];
	const r = r1(Math.max(0, bd - 0.5) * res);

	// 3x3 box blur: smooth, sub-cell contours
	const F = new Float32Array(W * H);
	for (let j = 0; j < H; j++)
		for (let i = 0; i < W; i++) {
			let s = 0;
			for (let dj = -1; dj <= 1; dj++) {
				const jj = j + dj;
				if (jj < 0 || jj >= H) continue;
				for (let di = -1; di <= 1; di++) {
					const ii = i + di;
					if (ii >= 0 && ii < W) s += bits[jj * W + ii];
				}
			}
			F[j * W + i] = s / 9;
		}

	// marching squares between cell centres, segments keep the inside on their left
	const next = new Map<number, number>();
	const Hid = (i: number, j: number) => (j * W + i) * 2;
	const Vid = (i: number, j: number) => (j * W + i) * 2 + 1;
	const seg = (a: number, b: number) => next.set(a, b);
	for (let j = 0; j < H - 1; j++)
		for (let i = 0; i < W - 1; i++) {
			const f0 = F[j * W + i];
			const f1 = F[j * W + i + 1];
			const f2 = F[(j + 1) * W + i + 1];
			const f3 = F[(j + 1) * W + i];
			const c =
				(f0 >= 0.5 ? 1 : 0) | (f1 >= 0.5 ? 2 : 0) | (f2 >= 0.5 ? 4 : 0) | (f3 >= 0.5 ? 8 : 0);
			if (c === 0 || c === 15) continue;
			const e0 = Hid(i, j); // bottom
			const e1 = Vid(i + 1, j); // right
			const e2 = Hid(i, j + 1); // top
			const e3 = Vid(i, j); // left
			switch (c) {
				case 1:
					seg(e0, e3);
					break;
				case 2:
					seg(e1, e0);
					break;
				case 3:
					seg(e1, e3);
					break;
				case 4:
					seg(e2, e1);
					break;
				case 5:
					if ((f0 + f1 + f2 + f3) / 4 >= 0.5) {
						seg(e1, e0);
						seg(e3, e2);
					} else {
						seg(e0, e3);
						seg(e2, e1);
					}
					break;
				case 6:
					seg(e2, e0);
					break;
				case 7:
					seg(e2, e3);
					break;
				case 8:
					seg(e3, e2);
					break;
				case 9:
					seg(e0, e2);
					break;
				case 10:
					if ((f0 + f1 + f2 + f3) / 4 >= 0.5) {
						seg(e3, e0);
						seg(e1, e2);
					} else {
						seg(e1, e0);
						seg(e3, e2);
					}
					break;
				case 11:
					seg(e1, e2);
					break;
				case 12:
					seg(e3, e1);
					break;
				case 13:
					seg(e0, e1);
					break;
				case 14:
					seg(e3, e0);
					break;
			}
		}
	const point = (id: number): Pt => {
		const vert = id & 1;
		const idx = id >> 1;
		const i = idx % W;
		const j = (idx - i) / W;
		if (!vert) {
			const a = F[j * W + i];
			const b = F[j * W + i + 1];
			const t = b === a ? 0.5 : (0.5 - a) / (b - a);
			return [ox + (i + t + 0.5) * res, oy + (j + 0.5) * res];
		}
		const a = F[j * W + i];
		const b = F[(j + 1) * W + i];
		const t = b === a ? 0.5 : (0.5 - a) / (b - a);
		return [ox + (i + 0.5) * res, oy + (j + t + 0.5) * res];
	};
	const seen = new Set<number>();
	let rings: Pt[][] = [];
	for (const start of next.keys()) {
		if (seen.has(start)) continue;
		const ring: Pt[] = [];
		let id = start;
		while (!seen.has(id)) {
			seen.add(id);
			ring.push(point(id));
			const n = next.get(id);
			if (n === undefined) break;
			id = n;
		}
		if (ring.length >= 3 && id === start) rings.push(ring);
	}
	rings = rings.filter((rg) => Math.abs(ringArea(rg)) >= minArea);
	if (!rings.length) return null;

	// simplify, tightening the tolerance until the point budget holds
	let tol = tol0;
	let out: Pt[][] = [];
	for (let attempt = 0; attempt < 14; attempt++) {
		out = rings.map((rg) => simplifyRing(rg, tol)).filter((rg) => rg.length >= 3);
		const total = out.reduce((a, rg) => a + rg.length, 0);
		if (total <= maxPoints) break;
		tol *= 1.3;
	}
	// still too many: drop the smallest holes and islands
	out.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
	let total = 0;
	const kept: Pt[][] = [];
	for (const rg of out) {
		if (kept.length && total + rg.length > maxPoints) continue;
		kept.push(rg);
		total += rg.length;
	}
	return {
		rings: kept.map((rg) => rg.map(([x, y]) => [r1(x), r1(y)] as Pt)),
		pole,
		r
	};
}

/** Silhouettes of a piece in its profile orientation and in each of its poses. */
export function computePieceSilhouettes(
	mesh: SilMesh,
	poses: readonly { m: readonly number[]; t: readonly number[] }[],
	opts?: SilOptions
): PieceSilhouettes | null {
	const profile = computeSilhouette(mesh, null, opts);
	if (!profile) return null;
	return {
		v: SIL_VERSION,
		profile,
		poses: poses.map((p) => computeSilhouette(mesh, p, opts) ?? profile)
	};
}

/** Rotate rings (degrees, counter-clockwise, about the origin) and move them by (dx, dy). */
export function placeRings(rings: readonly (readonly Pt[])[], deg: number, dx = 0, dy = 0): Pt[][] {
	const rad = (deg * Math.PI) / 180;
	const c = Math.round(Math.cos(rad) * 1e9) / 1e9;
	const s = Math.round(Math.sin(rad) * 1e9) / 1e9;
	return rings.map((rg) => rg.map(([x, y]) => [x * c - y * s + dx, x * s + y * c + dy] as Pt));
}

/** SVG path data for rings in bed coordinates (y up); `flipY` is the bed depth, so y is drawn top-down. */
export function ringsToPath(rings: readonly (readonly Pt[])[], flipY: number): string {
	let d = '';
	for (const rg of rings) {
		for (let i = 0; i < rg.length; i++)
			d += `${i ? 'L' : 'M'}${r1(rg[i][0])} ${r1(flipY - rg[i][1])}`;
		d += 'Z';
	}
	return d;
}

/** SVG path data of a rounded rectangle centred on (cx, cy), for pieces without a mesh. */
export function roundedRectPath(cx: number, cy: number, w: number, d: number): string {
	const rx = Math.max(0.5, Math.min(4, Math.min(w, d) / 5));
	const x0 = cx - w / 2;
	const y0 = cy - d / 2;
	const x1 = cx + w / 2;
	const y1 = cy + d / 2;
	const f = r1;
	return (
		`M${f(x0 + rx)} ${f(y0)}H${f(x1 - rx)}Q${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + rx)}` +
		`V${f(y1 - rx)}Q${f(x1)} ${f(y1)} ${f(x1 - rx)} ${f(y1)}H${f(x0 + rx)}` +
		`Q${f(x0)} ${f(y1)} ${f(x0)} ${f(y1 - rx)}V${f(y0 + rx)}Q${f(x0)} ${f(y0)} ${f(x0 + rx)} ${f(y0)}Z`
	);
}

// ---- colors for the diagram

const parseHex = (hex: string): [number, number, number] | null => {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

/** Relative luminance 0..1 of a hex color (0.5 for anything unparseable). */
export function luminance(hex: string): number {
	const rgb = parseHex(hex);
	if (!rgb) return 0.5;
	const [r, g, b] = rgb.map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h =
		max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
	const k = (n: number) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	const x = (v: number) =>
		Math.round(v * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${x(f(0))}${x(f(8))}${x(f(4))}`;
}

/**
 * Edge color for a filament: a darker shade of the same hue, or a lighter one when the
 * filament is so dark that a darker edge would vanish (black TPU on a grey bed).
 */
export function edgeColor(hex: string): string {
	const rgb = parseHex(hex);
	if (!rgb) return '#555555';
	const [h, s, l] = toHsl(rgb);
	if (luminance(hex) < 0.12) return fromHsl(h, Math.min(s, 0.35), Math.min(0.78, l + 0.42));
	return fromHsl(h, Math.min(1, s * 1.05), Math.max(0.06, l * 0.6));
}
