/**
 * Post-packing layout optimiser for one plate. The packer decides WHICH items share a plate
 * (boxes, MaxRects); this only moves and flat-rotates (about z) the items of a plate to leave as
 * much room as possible to the bed's usable edges and keep-out areas, using the true outlines
 * (convex hulls) for the distances. Pure and deterministic (no randomness), capped work.
 *
 * Objective, compared lexicographically (a better layout wins at the first level that differs
 * by more than `TOL` mm):
 *  1. the sorted list of per-item clearances (to the usable edges and keep-outs, each capped at
 *     `CAP_CLEAR`): the smallest first, then the next smallest, ...
 *  2. the smallest item-to-item gap (capped at spacing + `CAP_GAP`)
 *  3. how far the layout's centre (area-weighted centroid plus box centre) is from the bed centre.
 * Feasibility never gets worse than the packer's layout: distances may not drop below
 * min(required, what the start layout has), so a tight plate stays valid.
 *
 * `x`/`y`/`ox`/`oy` keep the arranger's pivot semantics: the mesh is moved to (x - ox, y - oy)
 * after turning by `rot`; (x, y) is the centre of the turned outline's box.
 */
import {
	polygonDistance,
	rectPoly,
	rotatePoints,
	simplifyHull,
	turnedOutlineBox,
	type Pt
} from './geom2d.ts';

const TOL = 0.05;
const CAP_CLEAR = 20;
const CAP_GAP = 4;
const MAX_EVALS = 12000;
const STEPS = [20, 10, 5, 2.5, 1, 0.5, 0.2, 0.1];
const DIRS: Pt[] = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
	[1, 1],
	[1, -1],
	[-1, 1],
	[-1, -1]
];

export interface OptItem {
	/** Convex outline around the box centre, counter-clockwise, unrotated. */
	outline: readonly Pt[];
	/** May be turned about z by a free angle (it already has one; 0/90 items only move). */
	rotatable: boolean;
	/** Extra angles to try (the fitter's feasible candidates). */
	angles?: readonly number[];
	rot: number;
	x: number;
	y: number;
	ox?: number;
	oy?: number;
	w: number;
	d: number;
}

export interface OptSetup {
	bedX: number;
	bedY: number;
	margin: number;
	spacing: number;
	keepOut?: readonly { x: number; y: number; w: number; d: number }[];
}

export interface LayoutMetrics {
	/** Smallest clearance of any item to the usable edges / keep-outs (mm, capped). */
	minClearance: number;
	/** Smallest gap between two items (mm, capped), Infinity with one item. */
	minGap: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const ceil1 = (n: number) => Math.ceil(n * 10 - 1e-9) / 10;
const norm = (d: number) => r2(((d % 360) + 360) % 360);

interface Turn {
	deg: number;
	/** Outline turned by deg (not moved). */
	pts: Pt[];
	/** Conservative simplified copy for distances (built on first use). */
	readonly simp: Pt[];
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	ox: number;
	oy: number;
	w: number;
	d: number;
}

interface Node {
	item: OptItem;
	turns: Map<number, Turn>;
	deg: number;
	x: number;
	y: number;
}

function makeTurn(outline: readonly Pt[], degIn: number): Turn {
	const deg = norm(degIn);
	const pts =
		deg === 0 ? outline.map((p) => [...p] as Pt) : rotatePoints(outline, (deg * Math.PI) / 180);
	let minX = Infinity,
		maxX = -Infinity,
		minY = Infinity,
		maxY = -Infinity;
	for (const [x, y] of pts) {
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	const b = turnedOutlineBox(outline, deg);
	const axis = deg % 90 === 0;
	let simp: Pt[] | null = null;
	return {
		deg,
		pts,
		get simp() {
			return (simp ??= pts.length > 28 ? simplifyHull(pts, 28) : pts);
		},
		minX,
		maxX,
		minY,
		maxY,
		ox: axis ? 0 : r2(b.cx),
		oy: axis ? 0 : r2(b.cy),
		w: ceil1(b.w),
		d: ceil1(b.d)
	};
}

/** An item's outline moved into place: the simplified (superset) and the exact hull. */
class World {
	private _s: Pt[] | null = null;
	private _f: Pt[] | null = null;
	constructor(
		readonly t: Turn,
		readonly px: number,
		readonly py: number
	) {}
	get s(): Pt[] {
		return (this._s ??= this.t.simp.map(([a, b]) => [a + this.px, b + this.py] as Pt));
	}
	get f(): Pt[] {
		return (this._f ??= this.t.pts.map(([a, b]) => [a + this.px, b + this.py] as Pt));
	}
}

class Layout {
	nodes: Node[];
	ux0: number;
	ux1: number;
	uy0: number;
	uy1: number;
	zones: { poly: Pt[]; x0: number; y0: number; x1: number; y1: number }[];
	evals = 0;
	constructor(
		items: readonly OptItem[],
		readonly s: OptSetup
	) {
		this.nodes = items.map((item) => {
			const n: Node = { item, turns: new Map(), deg: norm(item.rot), x: item.x, y: item.y };
			const t = this.turn(n, item.rot);
			// keep the stored pivot of the start layout exactly (the packer's rounding)
			t.ox = item.ox ?? t.ox;
			t.oy = item.oy ?? t.oy;
			return n;
		});
		this.ux0 = s.margin;
		this.ux1 = s.bedX - s.margin;
		this.uy0 = s.margin;
		this.uy1 = s.bedY - s.margin;
		this.zones = (s.keepOut ?? []).map((z) => ({
			poly: rectPoly(z.x, z.y, z.w, z.d),
			x0: z.x,
			y0: z.y,
			x1: z.x + z.w,
			y1: z.y + z.d
		}));
	}
	turn(n: Node, deg: number): Turn {
		const k = norm(deg);
		let t = n.turns.get(k);
		if (!t) {
			t = makeTurn(n.item.outline, k);
			n.turns.set(k, t);
		}
		return t;
	}
	/** World bounding box of a node at (deg, x, y). */
	box(t: Turn, x: number, y: number) {
		const px = x - t.ox;
		const py = y - t.oy;
		return { x0: t.minX + px, x1: t.maxX + px, y0: t.minY + py, y1: t.maxY + py, px, py };
	}
	world(t: Turn, x: number, y: number): World {
		return new World(t, x - t.ox, y - t.oy);
	}
	/** Clearance to the usable edges and keep-outs (capped). */
	clearance(t: Turn, x: number, y: number): number {
		const b = this.box(t, x, y);
		let c = Math.min(b.x0 - this.ux0, this.ux1 - b.x1, b.y0 - this.uy0, this.uy1 - b.y1);
		if (c > CAP_CLEAR) c = CAP_CLEAR;
		const m = this.s.margin;
		let w: World | null = null;
		for (const z of this.zones) {
			const gx = Math.max(z.x0 - b.x1, b.x0 - z.x1);
			const gy = Math.max(z.y0 - b.y1, b.y0 - z.y1);
			if (Math.max(gx, gy) - m >= c) continue;
			w ??= this.world(t, x, y);
			let dz = polygonDistance(w.s, z.poly) - m;
			if (dz < c) dz = Math.max(dz, polygonDistance(w.f, z.poly) - m); // exact outline
			c = Math.min(c, dz);
		}
		return c;
	}
	/** Gap between two placed outlines, capped; exact only when the simplified superset is below `req`. */
	gap(
		ta: Turn,
		xa: number,
		ya: number,
		wa: World,
		tb: Turn,
		xb: number,
		yb: number,
		wb: World,
		req = Infinity
	) {
		const cap = this.s.spacing + CAP_GAP;
		const a = this.box(ta, xa, ya);
		const b = this.box(tb, xb, yb);
		const gx = Math.max(a.x0 - b.x1, b.x0 - a.x1);
		const gy = Math.max(a.y0 - b.y1, b.y0 - a.y1);
		if (Math.max(gx, gy) >= cap) return cap;
		const g = polygonDistance(wa.s, wb.s);
		if (g >= cap) return cap;
		if (g >= req) return g;
		// the simplified outlines are a conservative superset: check the exact ones when they are close
		return Math.min(cap, Math.max(g, polygonDistance(wa.f, wb.f)));
	}
}

interface Score {
	cl: number[];
	gap: number;
	centre: number;
}

function better(a: Score, b: Score): number {
	for (let k = 0; k < a.cl.length; k++) {
		const d = a.cl[k] - b.cl[k];
		if (Math.abs(d) > TOL) return d;
	}
	if (Math.abs(a.gap - b.gap) > TOL) return a.gap - b.gap;
	return b.centre - a.centre > TOL ? 1 : a.centre - b.centre > TOL ? -1 : 0;
}

/** Optimise one plate: returns new placements (same order); inputs are not modified. */
export function optimizeLayout<T extends OptItem>(items: readonly T[], setup: OptSetup): OptItem[] {
	const n = items.length;
	if (n === 0) return [];
	const L = new Layout(items, setup);
	const nodes = L.nodes;
	const cx = (L.ux0 + L.ux1) / 2;
	const cy = (L.uy0 + L.uy1) / 2;
	const wts = items.map((i) => Math.max(1, i.w * i.d));
	const wsum = wts.reduce((a, b) => a + b, 0);

	const cur = (i: number) => L.turn(nodes[i], nodes[i].deg);
	const clr: number[] = [];
	const worlds: World[] = [];
	let gapReq = Infinity; // exact distances for the start layout, then only near the limit
	const gaps: number[][] = Array.from({ length: n }, () =>
		new Array<number>(n).fill(setup.spacing + CAP_GAP)
	);
	const refresh = (i: number) => {
		const t = cur(i);
		clr[i] = L.clearance(t, nodes[i].x, nodes[i].y);
		worlds[i] = L.world(t, nodes[i].x, nodes[i].y);
	};
	const regap = (i: number) => {
		for (let j = 0; j < n; j++) {
			if (j === i) continue;
			const g = L.gap(
				cur(i),
				nodes[i].x,
				nodes[i].y,
				worlds[i],
				cur(j),
				nodes[j].x,
				nodes[j].y,
				worlds[j],
				gapReq
			);
			gaps[i][j] = gaps[j][i] = g;
		}
	};
	for (let i = 0; i < n; i++) refresh(i);
	for (let i = 0; i < n; i++) regap(i);

	const centreOf = (cl: (i: number) => { x: number; y: number; w: number; h: number }) => {
		let sx = 0,
			sy = 0,
			x0 = Infinity,
			x1 = -Infinity,
			y0 = Infinity,
			y1 = -Infinity;
		for (let i = 0; i < n; i++) {
			const b = cl(i);
			sx += (b.x * wts[i]) / wsum;
			sy += (b.y * wts[i]) / wsum;
			x0 = Math.min(x0, b.x - b.w / 2);
			x1 = Math.max(x1, b.x + b.w / 2);
			y0 = Math.min(y0, b.y - b.h / 2);
			y1 = Math.max(y1, b.y + b.h / 2);
		}
		return Math.hypot(sx - cx, sy - cy) + Math.hypot((x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy);
	};
	const boxCentre = (i: number, deg = nodes[i].deg, x = nodes[i].x, y = nodes[i].y) => {
		const t = L.turn(nodes[i], deg);
		const b = L.box(t, x, y);
		return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, w: b.x1 - b.x0, h: b.y1 - b.y0 };
	};
	const minGapExcl = (skip: number) => {
		let g = setup.spacing + CAP_GAP;
		for (let a = 0; a < n; a++)
			if (a !== skip)
				for (let b = a + 1; b < n; b++) if (b !== skip && gaps[a][b] < g) g = gaps[a][b];
		return g;
	};
	const sorted = (v: number[]) => [...v].sort((a, b) => a - b);
	const whole = (): Score => {
		let g = setup.spacing + CAP_GAP;
		for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) g = Math.min(g, gaps[a][b]);
		return { cl: sorted(clr), gap: g, centre: centreOf((i) => boxCentre(i)) };
	};

	// feasibility floors: never below the packer's layout, never below what is required
	const reqC = Math.min(0, ...clr) - 1e-6;
	const reqG = Math.min(setup.spacing, minGapExcl(-1)) - 1e-6;
	gapReq = reqG;

	// 1. centre the whole group (distances between items stay)
	{
		let x0 = Infinity,
			x1 = -Infinity,
			y0 = Infinity,
			y1 = -Infinity;
		for (let i = 0; i < n; i++) {
			const b = boxCentre(i);
			x0 = Math.min(x0, b.x - b.w / 2);
			x1 = Math.max(x1, b.x + b.w / 2);
			y0 = Math.min(y0, b.y - b.h / 2);
			y1 = Math.max(y1, b.y + b.h / 2);
		}
		const dx = cx - (x0 + x1) / 2;
		const dy = cy - (y0 + y1) / 2;
		const before = whole();
		for (const f of [1, 0.5, 0.25, 0.125]) {
			const sx = r1(dx * f);
			const sy = r1(dy * f);
			if (sx === 0 && sy === 0) continue;
			const saved = nodes.map((nd) => [nd.x, nd.y] as const);
			nodes.forEach((nd) => {
				nd.x = r1(nd.x + sx);
				nd.y = r1(nd.y + sy);
			});
			for (let i = 0; i < n; i++) refresh(i);
			for (let i = 0; i < n; i++) regap(i);
			if (Math.min(...clr) >= reqC && better(whole(), before) >= 0) break;
			nodes.forEach((nd, i) => {
				nd.x = saved[i][0];
				nd.y = saved[i][1];
			});
			for (let i = 0; i < n; i++) refresh(i);
			for (let i = 0; i < n; i++) regap(i);
		}
	}

	// 2. coordinate descent: largest items first
	const order = [...Array(n).keys()].sort((a, b) => wts[b] - wts[a] || a - b);

	/** Score of node i at (deg, x, y) or null when infeasible. */
	const evalAt = (i: number, deg: number, x: number, y: number, others: number): Score | null => {
		if (++L.evals > MAX_EVALS) return null;
		const t = L.turn(nodes[i], deg);
		const c = L.clearance(t, x, y);
		if (c < reqC) return null;
		// leximin: an item that ends up with less clearance than it has now can only make things worse
		if (c < clr[i] - TOL) return null;
		const wp = L.world(t, x, y);
		let g = others;
		for (let j = 0; j < n; j++) {
			if (j === i) continue;
			const gg = L.gap(t, x, y, wp, cur(j), nodes[j].x, nodes[j].y, worlds[j], reqG);
			if (gg < reqG) return null;
			if (gg < g) g = gg;
		}
		const cl = sorted(clr.map((v, k) => (k === i ? c : v)));
		const b = boxCentre(i, deg, x, y);
		const centre = centreOf((k) => (k === i ? b : boxCentre(k)));
		return { cl, gap: g, centre };
	};
	const commit = (i: number, deg: number, x: number, y: number) => {
		nodes[i].deg = norm(deg);
		nodes[i].x = x;
		nodes[i].y = y;
		refresh(i);
		regap(i);
	};

	const angleSet = (i: number): number[] => {
		const nd = nodes[i];
		if (!nd.item.rotatable) return [];
		const base = nd.deg;
		const out = new Set<number>();
		if (n === 1) {
			// alone on the plate: every angle by the box clearance (2 degree steps), then fine steps
			// around the best few peaks; the exact check is done by the evaluation
			const ux = L.ux1 - L.ux0;
			const uy = L.uy1 - L.uy0;
			const cl: number[] = [];
			for (let k = 0; k < 180; k++) {
				const b = turnedOutlineBox(nd.item.outline, k * 2);
				cl.push(Math.min(ux - b.w, uy - b.d));
			}
			const peaks = cl
				.map((c, k) => ({ c, k }))
				.filter(({ c, k }) => c >= cl[(k + 179) % 180] && c > cl[(k + 1) % 180])
				.sort((a, b) => b.c - a.c || a.k - b.k)
				.slice(0, 4);
			for (const { k } of peaks) for (let d = -20; d <= 20; d++) out.add(norm(k * 2 + d * 0.1));
			for (const a of nd.item.angles ?? []) out.add(norm(a));
		} else {
			for (let k = -30; k <= 30; k++) if (k) out.add(norm(base + k * 0.5));
			for (const a of nd.item.angles ?? []) out.add(norm(a));
		}
		out.delete(base);
		return [...out].sort((a, b) => a - b);
	};

	let current = whole();
	// only items near a change are looked at again
	const dirty = new Array<boolean>(n).fill(true);
	const touch = (i: number) => {
		const b = boxCentre(i);
		for (let j = 0; j < n; j++) {
			if (j === i) continue;
			const c = boxCentre(j);
			if (Math.abs(c.x - b.x) - (c.w + b.w) / 2 < 45 && Math.abs(c.y - b.y) - (c.h + b.h) / 2 < 45)
				dirty[j] = true;
		}
	};
	const descend = () => {
		for (let pass = 0; pass < 6 && L.evals < MAX_EVALS; pass++) {
			let moved = false;
			for (const i of order) {
				if (!dirty[i]) continue;
				dirty[i] = false;
				const others = minGapExcl(i);
				// rotation (free-angle items): keep the box centre, clamp into the usable area
				let bestRot: { deg: number; x: number; y: number; s: Score } | null = null;
				for (const a of angleSet(i)) {
					const t = L.turn(nodes[i], a);
					const hw = (t.maxX - t.minX) / 2;
					const hh = (t.maxY - t.minY) / 2;
					const x = r1(Math.min(Math.max(nodes[i].x, L.ux0 + hw), L.ux1 - hw));
					const y = r1(Math.min(Math.max(nodes[i].y, L.uy0 + hh), L.uy1 - hh));
					const s = evalAt(i, a, x, y, others);
					if (s && better(s, bestRot?.s ?? current) > 0) bestRot = { deg: a, x, y, s };
				}
				if (bestRot) {
					commit(i, bestRot.deg, bestRot.x, bestRot.y);
					current = whole();
					moved = true;
					touch(i);
				}
				// translation
				for (const step of n > 12 ? STEPS.slice(0, 3) : n > 1 ? STEPS.slice(0, 5) : STEPS) {
					for (let guard = 0; guard < 16; guard++) {
						const o2 = minGapExcl(i);
						let best: { x: number; y: number; s: Score } | null = null;
						for (const [dx, dy] of DIRS) {
							const len = dx && dy ? step / Math.SQRT2 : step;
							const x = r1(nodes[i].x + dx * len);
							const y = r1(nodes[i].y + dy * len);
							if (x === nodes[i].x && y === nodes[i].y) continue;
							const s = evalAt(i, nodes[i].deg, x, y, o2);
							if (s && better(s, best?.s ?? current) > 0) best = { x, y, s };
						}
						if (!best) break;
						commit(i, nodes[i].deg, best.x, best.y);
						current = whole();
						moved = true;
						touch(i);
					}
				}
			}
			if (!moved) break;
		}
	};
	descend();

	// 3. push moves (small plates): move an item and push the neighbours that are in the way along
	// with it, so two items squeezed between edges can share the slack. Accepted only when the
	// whole layout improves.
	const tryPush = (i: number, dx: number, dy: number): boolean => {
		// cheap pre-check: item i itself must gain (or keep) clearance and be blocked by a neighbour
		// (an unblocked move was already tried by the plain descent)
		{
			const t = cur(i);
			const nx = r1(nodes[i].x + dx);
			const ny = r1(nodes[i].y + dy);
			const c = L.clearance(t, nx, ny);
			if (c < reqC || c < clr[i] - TOL) return false;
			const w = L.world(t, nx, ny);
			let blocked = false;
			for (let j = 0; j < n && !blocked; j++)
				if (j !== i && L.gap(t, nx, ny, w, cur(j), nodes[j].x, nodes[j].y, worlds[j], reqG) < reqG)
					blocked = true;
			if (!blocked) return false;
		}
		const savedPos = nodes.map((nd) => [nd.x, nd.y] as const);
		const savedClr = [...clr];
		const savedWorlds = [...worlds];
		const savedGaps = gaps.map((r) => [...r]);
		const revert = () => {
			nodes.forEach((nd, k) => {
				nd.x = savedPos[k][0];
				nd.y = savedPos[k][1];
			});
			for (let k = 0; k < n; k++) {
				clr[k] = savedClr[k];
				worlds[k] = savedWorlds[k];
				gaps[k] = savedGaps[k];
			}
		};
		const S = new Set([i]);
		for (let round = 0; round <= n; round++) {
			for (const m of S) {
				nodes[m].x = r1(savedPos[m][0] + dx);
				nodes[m].y = r1(savedPos[m][1] + dy);
				refresh(m);
				if (clr[m] < reqC) {
					revert();
					return false;
				}
			}
			let grew = false;
			for (let j = 0; j < n; j++) {
				if (S.has(j)) continue;
				for (const m of S)
					if (
						L.gap(
							cur(m),
							nodes[m].x,
							nodes[m].y,
							worlds[m],
							cur(j),
							nodes[j].x,
							nodes[j].y,
							worlds[j],
							reqG
						) < reqG
					) {
						S.add(j);
						grew = true;
						break;
					}
			}
			if (!grew) break;
		}
		L.evals += 40;
		for (const m of S) regap(m);
		let feasible = true;
		for (const m of S)
			for (let j = 0; j < n; j++) if (j !== m && gaps[m][j] < reqG) feasible = false;
		if (feasible && better(whole(), current) > 0) {
			current = whole();
			return true;
		}
		revert();
		return false;
	};
	if (n > 1 && n <= 9) {
		for (let round = 0; round < 3 && L.evals < MAX_EVALS; round++) {
			let improved = false;
			for (const i of order) {
				// only the items that limit the layout can raise its minimum clearance
				if (clr[i] > Math.min(...clr) + 3) continue;
				for (const step of [4, 1, 0.3])
					for (const [dx, dy] of DIRS) {
						const len = dx && dy ? step / Math.SQRT2 : step;
						if (tryPush(i, dx * len, dy * len)) improved = true;
					}
			}
			if (!improved) break;
			descend();
		}
	}

	return nodes.map((nd) => {
		const t = L.turn(nd, nd.deg);
		const axis = t.deg % 90 === 0;
		const out: OptItem = {
			...nd.item,
			rot: t.deg,
			x: nd.x,
			y: nd.y,
			w: t.w,
			d: t.d
		};
		// the start layout's own pivot stays when the angle did not change
		const same = Math.abs(norm(nd.item.rot) - t.deg) < 1e-9;
		const ox = same ? (nd.item.ox ?? t.ox) : t.ox;
		const oy = same ? (nd.item.oy ?? t.oy) : t.oy;
		if (same) {
			out.w = nd.item.w;
			out.d = nd.item.d;
		}
		if (axis && !ox && !oy) {
			delete out.ox;
			delete out.oy;
		} else {
			out.ox = ox;
			out.oy = oy;
		}
		return out;
	});
}

/** Smallest clearance to edges/keep-outs and smallest gap between items of a layout (outlines, capped). */
export function layoutMetrics(items: readonly OptItem[], setup: OptSetup): LayoutMetrics {
	const L = new Layout(items, setup);
	let minClearance = CAP_CLEAR;
	const worlds: Pt[][] = [];
	L.nodes.forEach((nd, i) => {
		const t = L.turn(nd, nd.deg);
		t.ox = items[i].ox ?? t.ox;
		t.oy = items[i].oy ?? t.oy;
		minClearance = Math.min(minClearance, L.clearance(t, nd.x, nd.y));
		worlds.push(L.world(t, nd.x, nd.y).f);
	});
	let minGap = Infinity;
	for (let a = 0; a < items.length; a++)
		for (let b = a + 1; b < items.length; b++) {
			const g = polygonDistance(worlds[a], worlds[b]);
			if (g < minGap) minGap = g;
		}
	return { minClearance, minGap };
}

/**
 * A spot on an empty plate where an outline turned by `rot` degrees keeps clear of the usable
 * edges and every keep-out area (exact outline), with the most clearance found, or null.
 * Used for big parts whose box does not fit around a keep-out but whose outline does.
 * Returns the box centre (x, y) in bed coordinates, rounded to 0.1 mm.
 */
export function findFreePosition(
	outline: readonly Pt[],
	rot: number,
	setup: OptSetup,
	pivot?: { ox: number; oy: number }
): { x: number; y: number; clearance: number } | null {
	const item: OptItem = {
		outline,
		rotatable: false,
		rot,
		x: 0,
		y: 0,
		ox: pivot?.ox,
		oy: pivot?.oy,
		w: 0,
		d: 0
	};
	const L = new Layout([item], setup);
	const t = L.turn(L.nodes[0], norm(rot));
	const x0 = L.ux0 - t.minX + t.ox;
	const x1 = L.ux1 - t.maxX + t.ox;
	const y0 = L.uy0 - t.minY + t.oy;
	const y1 = L.uy1 - t.maxY + t.oy;
	if (x1 < x0 - 1e-6 || y1 < y0 - 1e-6) return null;
	// candidate centres on the 0.1 mm grid inside the allowed range (at most ~40 per axis)
	const grid = (lo: number, hi: number): number[] => {
		const k0 = Math.ceil(lo * 10 - 1e-9);
		const k1 = Math.floor(hi * 10 + 1e-9);
		if (k1 < k0) return [];
		const n = k1 - k0 + 1;
		const stride = Math.max(1, Math.ceil(n / 40));
		const out: number[] = [];
		for (let k = k0; k <= k1; k += stride) out.push(k / 10);
		if (out[out.length - 1] !== k1 / 10) out.push(k1 / 10);
		return out;
	};
	let best: { x: number; y: number; clearance: number } | null = null;
	const ys = grid(y0, y1);
	for (const x of grid(x0, x1))
		for (const y of ys) {
			const c = L.clearance(t, x, y);
			if (c >= -1e-6 && (!best || c > best.clearance + 1e-9)) best = { x, y, clearance: c };
		}
	return best;
}
