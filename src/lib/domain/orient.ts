/**
 * Print orientation search for parts that do not fit the bed in the kit author's
 * orientation. Pure and deterministic (no DB, Node or Svelte).
 *
 * A mesh is stored in its profile orientation (z up, lowest vertex at 0, XY box centre at
 * the origin). `computePoses` lists alternative resting poses of that mesh: for every
 * sizeable facet of its 3D convex hull the facet's outward normal is turned to point down
 * (the facet lies on the bed), plus the six axis-aligned poses. Each pose is turned about
 * z to the minimum-area bounding rectangle of its footprint (rotating calipers) and
 * dropped to z = 0. `chooseOrientation` then picks, for a given bed, the profile
 * orientation when it fits, else the best fitting pose.
 *
 * A pose maps a stored vertex `p` to `m * p + t` (`m` row-major 3x3 rotation, `t` the
 * translation that centres the box in XY and puts the lowest point on z = 0). The arranger
 * then turns the result about z by `rotation` and moves it to `(x, y)`.
 */
import { boxOrients, bounds, convexHull, minAreaRect, simplifyHull, type Pt } from './geom2d.ts';

export const ORIENT_VERSION = 2;

export interface PrintPose {
	kind: 'face' | 'axis';
	/** Row-major 3x3 rotation (includes the in-plane turn to the minimum-area rectangle). */
	m: number[];
	/** Translation after the rotation: centres the XY box on the origin, lowest point at z = 0. */
	t: [number, number, number];
	/** Box after the pose, w >= d. */
	w: number;
	d: number;
	h: number;
	/** Outline of the footprint around the box centre (at most 16 points). */
	hull: Pt[];
	/** Area resting on the bed, mm2 (hull facet area for face poses). */
	contactArea: number;
	/** Weighted area (mm2) of downward faces flatter than 45 degrees that hang above the bed. */
	supportScore: number;
	/** Whether the centre of mass lies over the resting facet (a pose that does not tip over). */
	stable: boolean;
}

/** Stored per piece (`PrintPiece.orient`). */
export interface OrientData {
	v: number;
	profile: { contactArea: number; supportScore: number };
	poses: PrintPose[];
}

export interface Mesh3 {
	positions: ArrayLike<number>;
	indices: ArrayLike<number>;
}

export interface ProfileShape {
	w: number;
	d: number;
	h: number;
	hull?: Pt[];
	contactArea?: number;
	supportScore?: number;
}

export interface OrientBed {
	usableX: number;
	usableY: number;
	/** Largest part height (bed Z minus a margin); Infinity when unknown. */
	maxH: number;
}

export interface OrientResult {
	/** False when neither the profile orientation nor any pose fits. */
	fits: boolean;
	reoriented: boolean;
	/** The chosen pose; null = the profile orientation (identity). */
	pose: PrintPose | null;
	/** Row-major 3x3 rotation of the stored mesh (identity for the profile). */
	rotation: number[];
	translation: [number, number, number];
	footprint: { w: number; d: number };
	hull2d: Pt[];
	height: number;
	contactArea: number;
	supportScore: number;
	/** Candidates examined (profile + poses). */
	tried: number;
}

export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ---- 3D convex hull (quickhull)

interface HFace {
	a: number;
	b: number;
	c: number;
	nx: number;
	ny: number;
	nz: number;
	d: number;
	out: number[];
	alive: boolean;
}

/**
 * Convex hull of points (flat xyz array). Returns triangles with outward counter-clockwise
 * winding as vertex indices, or null when the points are (nearly) flat or too few.
 */
export function convexHull3D(xyz: ArrayLike<number>): [number, number, number][] | null {
	const n = Math.floor(xyz.length / 3);
	if (n < 4) return null;
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < n; i++)
		for (let k = 0; k < 3; k++) {
			const v = xyz[i * 3 + k];
			if (v < min[k]) min[k] = v;
			if (v > max[k]) max[k] = v;
		}
	const scale = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
	if (!(scale > 0)) return null;
	const eps = 1e-6 * scale;
	const P = (i: number) => [xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]];

	// initial tetrahedron
	let i0 = 0;
	let i1 = 0;
	{
		const ext: number[] = [];
		for (let k = 0; k < 3; k++) {
			let lo = 0;
			let hi = 0;
			for (let i = 1; i < n; i++) {
				if (xyz[i * 3 + k] < xyz[lo * 3 + k]) lo = i;
				if (xyz[i * 3 + k] > xyz[hi * 3 + k]) hi = i;
			}
			ext.push(lo, hi);
		}
		let bd = -1;
		for (const a of ext)
			for (const b of ext) {
				const pa = P(a);
				const pb = P(b);
				const dd = (pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2;
				if (dd > bd) {
					bd = dd;
					i0 = a;
					i1 = b;
				}
			}
		if (bd <= eps * eps) return null;
	}
	const p0 = P(i0);
	const p1 = P(i1);
	const e = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
	const el = Math.hypot(e[0], e[1], e[2]);
	let i2 = -1;
	let bl = eps;
	for (let i = 0; i < n; i++) {
		const q = P(i);
		const w = [q[0] - p0[0], q[1] - p0[1], q[2] - p0[2]];
		const c = [e[1] * w[2] - e[2] * w[1], e[2] * w[0] - e[0] * w[2], e[0] * w[1] - e[1] * w[0]];
		const dist = Math.hypot(c[0], c[1], c[2]) / el;
		if (dist > bl) {
			bl = dist;
			i2 = i;
		}
	}
	if (i2 < 0) return null;
	const p2 = P(i2);
	const nrm = (() => {
		const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
		const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
		const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
		const l = Math.hypot(c[0], c[1], c[2]);
		return [c[0] / l, c[1] / l, c[2] / l];
	})();
	let i3 = -1;
	let bp = eps;
	let sign = 1;
	for (let i = 0; i < n; i++) {
		const q = P(i);
		const dist = nrm[0] * (q[0] - p0[0]) + nrm[1] * (q[1] - p0[1]) + nrm[2] * (q[2] - p0[2]);
		if (Math.abs(dist) > bp) {
			bp = Math.abs(dist);
			i3 = i;
			sign = dist > 0 ? 1 : -1;
		}
	}
	if (i3 < 0) return null;

	const faces: HFace[] = [];
	const edge = new Map<number, number>(); // directed edge u*n+v -> face index
	const mk = (a: number, b: number, c: number, fallback?: HFace): number => {
		const pa = P(a);
		const pb = P(b);
		const pc = P(c);
		const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
		const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
		let cx = u[1] * v[2] - u[2] * v[1];
		let cy = u[2] * v[0] - u[0] * v[2];
		let cz = u[0] * v[1] - u[1] * v[0];
		const l = Math.hypot(cx, cy, cz);
		if (l > 1e-12) {
			cx /= l;
			cy /= l;
			cz /= l;
		} else if (fallback) {
			cx = fallback.nx;
			cy = fallback.ny;
			cz = fallback.nz;
		}
		const f: HFace = {
			a,
			b,
			c,
			nx: cx,
			ny: cy,
			nz: cz,
			d: cx * pa[0] + cy * pa[1] + cz * pa[2],
			out: [],
			alive: true
		};
		const idx = faces.length;
		faces.push(f);
		edge.set(a * n + b, idx);
		edge.set(b * n + c, idx);
		edge.set(c * n + a, idx);
		return idx;
	};
	const dist = (f: HFace, i: number) =>
		f.nx * xyz[i * 3] + f.ny * xyz[i * 3 + 1] + f.nz * xyz[i * 3 + 2] - f.d;

	// a, b, c counter-clockwise seen from outside with the fourth point below
	const [a, b, c] = sign > 0 ? [i0, i2, i1] : [i0, i1, i2];
	const dpt = i3;
	mk(a, b, c);
	mk(a, dpt, b);
	mk(b, dpt, c);
	mk(c, dpt, a);

	const used = new Set([a, b, c, dpt]);
	for (let i = 0; i < n; i++) {
		if (used.has(i)) continue;
		for (const f of faces)
			if (dist(f, i) > eps) {
				f.out.push(i);
				break;
			}
	}

	const stack: number[] = faces.map((_, i) => i).filter((i) => faces[i].out.length);
	while (stack.length) {
		const fi = stack.pop()!;
		const f = faces[fi];
		if (!f.alive || !f.out.length) continue;
		let far = f.out[0];
		let fd = dist(f, far);
		for (const i of f.out) {
			const dd = dist(f, i);
			if (dd > fd) {
				fd = dd;
				far = i;
			}
		}
		// visible region
		const visible = new Set<number>([fi]);
		const queue = [fi];
		while (queue.length) {
			const g = faces[queue.pop()!];
			for (const [u, v] of [
				[g.a, g.b],
				[g.b, g.c],
				[g.c, g.a]
			]) {
				const nb = edge.get(v * n + u);
				if (nb === undefined || visible.has(nb) || !faces[nb].alive) continue;
				if (dist(faces[nb], far) > eps) {
					visible.add(nb);
					queue.push(nb);
				}
			}
		}
		const horizon: [number, number][] = [];
		for (const vi of visible) {
			const g = faces[vi];
			for (const [u, v] of [
				[g.a, g.b],
				[g.b, g.c],
				[g.c, g.a]
			]) {
				const nb = edge.get(v * n + u);
				if (nb === undefined || !visible.has(nb)) horizon.push([u, v]);
			}
		}
		const orphans: number[] = [];
		for (const vi of visible) {
			const g = faces[vi];
			g.alive = false;
			edge.delete(g.a * n + g.b);
			edge.delete(g.b * n + g.c);
			edge.delete(g.c * n + g.a);
			for (const i of g.out) if (i !== far) orphans.push(i);
			g.out = [];
		}
		const fresh: number[] = [];
		for (const [u, v] of horizon) fresh.push(mk(u, v, far, f));
		for (const i of orphans)
			for (const ni of fresh)
				if (dist(faces[ni], i) > eps) {
					faces[ni].out.push(i);
					break;
				}
		for (const ni of fresh) if (faces[ni].out.length) stack.push(ni);
	}
	return faces.filter((g) => g.alive).map((g) => [g.a, g.b, g.c]);
}

// ---- pose computation

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: V3, b: V3): V3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0]
];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Row-major product a * b of two 3x3 matrices. */
export function mul3(a: readonly number[], b: readonly number[]): number[] {
	const o = new Array<number>(9).fill(0);
	for (let i = 0; i < 3; i++)
		for (let j = 0; j < 3; j++)
			for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
	return o;
}

/** Rotation (row-major) that turns the unit vector `n` to point straight down (0, 0, -1). */
export function rotationToDown(n: V3): number[] {
	const b: V3 = [0, 0, -1];
	const v = cross3(n, b);
	const s = Math.hypot(v[0], v[1], v[2]);
	const c = dot3(n, b);
	if (s < 1e-9) return c > 0 ? [...IDENTITY] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
	const k = [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
	const k2 = mul3(k, k);
	const f = 1 / (1 + c);
	return IDENTITY.map((id, i) => id + k[i] + k2[i] * f);
}

const rotZ = (rad: number) => {
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	return [c, -s, 0, s, c, 0, 0, 0, 1];
};

export function applyPose(m: readonly number[], t: readonly number[], p: readonly number[]): V3 {
	return [
		m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + t[0],
		m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + t[1],
		m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + t[2]
	];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const up1 = (n: number) => Math.ceil(n * 10 - 1e-6) / 10;

interface Prepared {
	pos: Float64Array;
	nv: number;
	tri: Uint32Array;
	nt: number;
	/** Per triangle outward unit normal and area. */
	nrm: Float64Array;
	area: Float64Array;
	hullFaces: [number, number, number][] | null;
	hullVerts: number[];
	com: V3;
}

function prepare(mesh: Mesh3): Prepared {
	const nv = Math.floor(mesh.positions.length / 3);
	const pos = Float64Array.from(mesh.positions as ArrayLike<number>);
	const nt = Math.floor(mesh.indices.length / 3);
	const tri = Uint32Array.from(mesh.indices as ArrayLike<number>);
	const nrm = new Float64Array(nt * 3);
	const area = new Float64Array(nt);
	let vol = 0;
	let cx = 0;
	let cy = 0;
	let cz = 0;
	const sum = [0, 0, 0];
	for (let t = 0; t < nt; t++) {
		const a: V3 = [pos[tri[t * 3] * 3], pos[tri[t * 3] * 3 + 1], pos[tri[t * 3] * 3 + 2]];
		const b: V3 = [
			pos[tri[t * 3 + 1] * 3],
			pos[tri[t * 3 + 1] * 3 + 1],
			pos[tri[t * 3 + 1] * 3 + 2]
		];
		const c: V3 = [
			pos[tri[t * 3 + 2] * 3],
			pos[tri[t * 3 + 2] * 3 + 1],
			pos[tri[t * 3 + 2] * 3 + 2]
		];
		const cr = cross3(sub(b, a), sub(c, a));
		const l = Math.hypot(cr[0], cr[1], cr[2]);
		area[t] = l / 2;
		if (l > 1e-12) {
			nrm[t * 3] = cr[0] / l;
			nrm[t * 3 + 1] = cr[1] / l;
			nrm[t * 3 + 2] = cr[2] / l;
		}
		const sv = dot3(a, cross3(b, c)) / 6;
		vol += sv;
		cx += (sv * (a[0] + b[0] + c[0])) / 4;
		cy += (sv * (a[1] + b[1] + c[1])) / 4;
		cz += (sv * (a[2] + b[2] + c[2])) / 4;
	}
	for (let i = 0; i < nv; i++) {
		sum[0] += pos[i * 3];
		sum[1] += pos[i * 3 + 1];
		sum[2] += pos[i * 3 + 2];
	}
	const com: V3 =
		Math.abs(vol) > 1e-6
			? [cx / vol, cy / vol, cz / vol]
			: [sum[0] / Math.max(1, nv), sum[1] / Math.max(1, nv), sum[2] / Math.max(1, nv)];
	// hull over the vertices that triangles use
	const usedIdx = new Set<number>();
	for (let i = 0; i < tri.length; i++) usedIdx.add(tri[i]);
	const ids = [...usedIdx].sort((a, b) => a - b);
	const flat = new Float64Array(ids.length * 3);
	ids.forEach((id, i) => {
		flat[i * 3] = pos[id * 3];
		flat[i * 3 + 1] = pos[id * 3 + 1];
		flat[i * 3 + 2] = pos[id * 3 + 2];
	});
	const hf = convexHull3D(flat);
	const hullFaces = hf
		? hf.map(([a, b, c]) => [ids[a], ids[b], ids[c]] as [number, number, number])
		: null;
	const hv = new Set<number>();
	if (hullFaces) for (const f of hullFaces) f.forEach((i) => hv.add(i));
	return {
		pos,
		nv,
		tri,
		nt,
		nrm,
		area,
		hullFaces,
		hullVerts: [...hv].sort((a, b) => a - b),
		com
	};
}

/** Contact and support estimate for a mesh placed with rotation `m` (row 3 decides heights). */
function measure(pr: Prepared, m: readonly number[], zmin: number) {
	const z = new Float64Array(pr.nv);
	for (let i = 0; i < pr.nv; i++)
		z[i] = m[6] * pr.pos[i * 3] + m[7] * pr.pos[i * 3 + 1] + m[8] * pr.pos[i * 3 + 2] - zmin;
	let contact = 0;
	let support = 0;
	for (let t = 0; t < pr.nt; t++) {
		const nz = m[6] * pr.nrm[t * 3] + m[7] * pr.nrm[t * 3 + 1] + m[8] * pr.nrm[t * 3 + 2];
		if (nz >= -0.7071) continue;
		const z0 = z[pr.tri[t * 3]];
		const z1 = z[pr.tri[t * 3 + 1]];
		const z2 = z[pr.tri[t * 3 + 2]];
		const lo = Math.min(z0, z1, z2);
		const hi = Math.max(z0, z1, z2);
		if (hi < 0.3 && nz < -0.99) contact += pr.area[t];
		else if (lo > 0.4) support += pr.area[t] * -nz;
	}
	return { contact, support };
}

interface Facet {
	n: V3;
	area: number;
	tris: [number, number, number][];
}

function facetsOf(pr: Prepared): Facet[] {
	if (!pr.hullFaces) return [];
	// Coplanar hull triangles share a bucket: normal rounded to 0.005, plane offset to 0.2 mm.
	const buckets = new Map<string, Facet>();
	for (const f of pr.hullFaces) {
		const a: V3 = [pr.pos[f[0] * 3], pr.pos[f[0] * 3 + 1], pr.pos[f[0] * 3 + 2]];
		const b: V3 = [pr.pos[f[1] * 3], pr.pos[f[1] * 3 + 1], pr.pos[f[1] * 3 + 2]];
		const c: V3 = [pr.pos[f[2] * 3], pr.pos[f[2] * 3 + 1], pr.pos[f[2] * 3 + 2]];
		const cr = cross3(sub(b, a), sub(c, a));
		const l = Math.hypot(cr[0], cr[1], cr[2]);
		if (l < 1e-12) continue;
		const n: V3 = [cr[0] / l, cr[1] / l, cr[2] / l];
		const off = dot3(n, a);
		const key = `${Math.round(n[0] * 200)},${Math.round(n[1] * 200)},${Math.round(n[2] * 200)},${Math.round(off * 5)}`;
		const hit = buckets.get(key);
		if (hit) {
			hit.area += l / 2;
			hit.tris.push(f);
		} else buckets.set(key, { n, area: l / 2, tris: [f] });
	}
	return [...buckets.values()];
}

/** Whether the centre of mass lies over the facet (inside one of its triangles, seen along the normal). */
function stableOn(pr: Prepared, fc: Facet): boolean {
	for (const [i, j, k] of fc.tris) {
		const idx = [i, j, k];
		let inside = true;
		for (let e = 0; e < 3 && inside; e++) {
			const u = idx[e];
			const v = idx[(e + 1) % 3];
			const pu: V3 = [pr.pos[u * 3], pr.pos[u * 3 + 1], pr.pos[u * 3 + 2]];
			const pv: V3 = [pr.pos[v * 3], pr.pos[v * 3 + 1], pr.pos[v * 3 + 2]];
			if (dot3(cross3(sub(pv, pu), sub(pr.com, pu)), fc.n) < -1e-6) inside = false;
		}
		if (inside) return true;
	}
	return false;
}

function buildPose(
	pr: Prepared,
	r0: number[],
	kind: PrintPose['kind'],
	facetArea: number,
	stable: boolean
): PrintPose | null {
	const verts = pr.hullFaces ? pr.hullVerts : Array.from({ length: pr.nv }, (_, i) => i);
	if (!verts.length) return null;
	const pts: Pt[] = [];
	let zlo = Infinity;
	let zhi = -Infinity;
	for (const i of verts) {
		const x = r0[0] * pr.pos[i * 3] + r0[1] * pr.pos[i * 3 + 1] + r0[2] * pr.pos[i * 3 + 2];
		const y = r0[3] * pr.pos[i * 3] + r0[4] * pr.pos[i * 3 + 1] + r0[5] * pr.pos[i * 3 + 2];
		const z = r0[6] * pr.pos[i * 3] + r0[7] * pr.pos[i * 3 + 1] + r0[8] * pr.pos[i * 3 + 2];
		pts.push([x, y]);
		if (z < zlo) zlo = z;
		if (z > zhi) zhi = z;
	}
	const hull0 = convexHull(pts);
	const rect = minAreaRect(hull0);
	const m = mul3(rotZ(rect.angle), r0);
	// rotate the footprint hull by the same angle, centre it
	const c = Math.cos(rect.angle);
	const s = Math.sin(rect.angle);
	const rot = hull0.map(([x, y]) => [x * c - y * s, x * s + y * c] as Pt);
	const b = bounds(rot);
	const cx = (b.minX + b.maxX) / 2;
	const cy = (b.minY + b.maxY) / 2;
	const hull = simplifyHull(
		rot.map(([x, y]) => [x - cx, y - cy] as Pt),
		16
	).map(([x, y]) => [r1(x), r1(y)] as Pt);
	const meas = measure(pr, m, zlo);
	return {
		kind,
		m: m.map((v) => Math.round(v * 1e6) / 1e6),
		t: [-cx, -cy, -zlo].map((v) => Math.round(v * 1e4) / 1e4) as V3,
		w: up1(b.w),
		d: up1(b.d),
		h: up1(zhi - zlo),
		hull,
		contactArea: r1(Math.max(meas.contact, kind === 'face' ? facetArea : 0)),
		supportScore: r1(meas.support),
		stable
	};
}

export interface PoseOptions {
	/** Most hull facets tried (largest first). Default 12. */
	maxFacets?: number;
	/** Smallest facet that counts as a resting face, mm2. Default 20. */
	minFacetArea?: number;
	/** Drop poses taller than this, mm. Default 500. */
	maxHeight?: number;
}

/**
 * Alternative resting poses of a mesh in its stored (profile) orientation, plus the contact
 * and support numbers of the profile orientation itself. Deterministic.
 */
export function computePoses(mesh: Mesh3, opts: PoseOptions = {}): OrientData {
	const pr = prepare(mesh);
	const base: OrientData = {
		v: ORIENT_VERSION,
		profile: { contactArea: 0, supportScore: 0 },
		poses: []
	};
	if (!pr.nt) return base;
	let zmin = Infinity;
	for (let i = 0; i < pr.nv; i++) zmin = Math.min(zmin, pr.pos[i * 3 + 2]);
	const pm = measure(pr, IDENTITY, zmin);
	base.profile = { contactArea: r1(pm.contact), supportScore: r1(pm.support) };

	const maxFacets = opts.maxFacets ?? 40;
	const minArea = opts.minFacetArea ?? 20;
	const maxH = opts.maxHeight ?? 500;
	const facets = facetsOf(pr)
		.filter((f) => f.area >= minArea)
		.sort((a, b) => b.area - a.area || a.n[2] - b.n[2] || a.n[0] - b.n[0] || a.n[1] - b.n[1])
		.slice(0, maxFacets);
	const cands: { n: V3; kind: PrintPose['kind']; area: number; stable: boolean }[] = facets.map(
		(f) => ({ n: f.n, kind: 'face' as const, area: f.area, stable: stableOn(pr, f) })
	);
	const axes: V3[] = [
		[0, 0, -1],
		[0, 0, 1],
		[1, 0, 0],
		[-1, 0, 0],
		[0, 1, 0],
		[0, -1, 0]
	];
	for (const n of axes)
		if (!cands.some((c) => dot3(c.n, n) > 0.9998)) {
			// an axis pose is stable when it is also a hull facet; otherwise it rests on an edge or point
			cands.push({ n, kind: 'axis', area: 0, stable: false });
		}
	const poses: PrintPose[] = [];
	for (const c of cands) {
		// resting on the stored bottom is the profile orientation itself
		if (dot3(c.n, [0, 0, -1]) > 0.9998) continue;
		const pose = buildPose(pr, rotationToDown(c.n), c.kind, c.area, c.stable);
		if (!pose || pose.h > maxH) continue;
		poses.push(pose);
	}
	base.poses = poses;
	return base;
}

// ---- choosing

/** Short description for messages: "stands on its edge, 248 mm tall" / "lies on another face". */
export function describePose(pose: PrintPose, profileH: number): string {
	const h = Math.round(pose.h);
	if (pose.h > Math.max(profileH * 2, Math.min(pose.w, pose.d) * 0.9))
		return `stands on its edge, ${h} mm tall`;
	return `lies on another face, ${h} mm tall`;
}

/**
 * Pick the orientation for a bed: the profile orientation when it fits (including turned
 * about z), else the fitting pose with the largest resting area (stable poses first, areas
 * within 5 % count as equal), then the least support, then the lowest height.
 */
export function chooseOrientation(
	profile: ProfileShape,
	poses: readonly PrintPose[],
	bed: OrientBed,
	rotate = true
): OrientResult {
	const fitsBox = (b: { w: number; d: number; hull?: Pt[] }) =>
		boxOrients(b, rotate, bed.usableX, bed.usableY).some(
			(o) => o.w <= bed.usableX + 1e-6 && o.d <= bed.usableY + 1e-6
		);
	const tried = poses.length + 1;
	const prof: OrientResult = {
		fits: fitsBox(profile) && profile.h <= bed.maxH + 1e-6,
		reoriented: false,
		pose: null,
		rotation: [...IDENTITY],
		translation: [0, 0, 0],
		footprint: { w: profile.w, d: profile.d },
		hull2d: profile.hull ?? [],
		height: profile.h,
		contactArea: profile.contactArea ?? 0,
		supportScore: profile.supportScore ?? 0,
		tried
	};
	if (prof.fits || !rotate) return prof;
	const ok = poses
		.map((p, i) => ({ p, i }))
		.filter(({ p }) => p.h <= bed.maxH + 1e-6 && fitsBox(p));
	if (!ok.length) return prof;
	const tier = (p: PrintPose) => (p.stable ? 0 : 1);
	const bestTier = Math.min(...ok.map(({ p }) => tier(p)));
	const pool = ok.filter(({ p }) => tier(p) === bestTier);
	const maxContact = Math.max(...pool.map(({ p }) => p.contactArea));
	pool.sort((x, y) => {
		const xc = x.p.contactArea >= maxContact * 0.95 ? 0 : 1;
		const yc = y.p.contactArea >= maxContact * 0.95 ? 0 : 1;
		return (
			xc - yc ||
			(xc === 0 ? 0 : y.p.contactArea - x.p.contactArea) ||
			x.p.supportScore - y.p.supportScore ||
			x.p.h - y.p.h ||
			x.i - y.i
		);
	});
	const pose = pool[0].p;
	return {
		fits: true,
		reoriented: true,
		pose,
		rotation: pose.m,
		translation: pose.t,
		footprint: { w: pose.w, d: pose.d },
		hull2d: pose.hull,
		height: pose.h,
		contactArea: pose.contactArea,
		supportScore: pose.supportScore,
		tried
	};
}

/** Convenience: poses of a mesh in its profile orientation and the choice for a bed. */
export function findOrientation(
	mesh: Mesh3,
	profile: ProfileShape,
	bed: OrientBed,
	rotate = true
): OrientResult & { data: OrientData } {
	const data = computePoses(mesh);
	const res = chooseOrientation({ ...profile, ...data.profile }, data.poses, bed, rotate);
	return { ...res, data };
}
