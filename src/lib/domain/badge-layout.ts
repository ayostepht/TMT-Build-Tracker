/**
 * Placement of the numbered badges on a plate diagram. Pure and framework-free.
 *
 * Every printed object gets a badge. A part big enough keeps it inside, at its most "inside"
 * point, scaled to the part (between `rMin` and `rMax`). A part too small for that (pins,
 * washers, connectors) gets its badge outside with a thin leader line; copies of the same
 * part that sit close together share one badge with a leader to each copy. Outside badges are
 * placed greedily at the nearest free spot around their anchor: not over any part, not over
 * another badge, inside the drawing area.
 *
 * All coordinates are drawing (SVG) units, y down, in the same frame as the part outlines.
 */
import type { Pt } from './geom2d.ts';

export interface BadgeItem {
	/** Stable id (index of the arranged item). */
	id: number;
	/** Part slug: only copies of one part are grouped. */
	slug: string;
	/** Most inside point of the outline. */
	pole: Pt;
	/** Radius of the largest circle inside the outline around `pole`. */
	inr: number;
	/** Outline rings (evenodd), for keeping outside badges off the parts. */
	rings: readonly (readonly Pt[])[];
}

export interface BadgeOptions {
	/** Smallest badge radius that is still legible. */
	rMin: number;
	/** Largest badge radius. */
	rMax: number;
	/** A badge stays inside while its radius is at most this share of the inscribed radius. */
	fill?: number;
	/** Gap kept between a badge and parts or other badges. */
	gap?: number;
	/** Copies of a part whose poles are closer than this share a badge (outside badges only). */
	clusterDist?: number;
	/** Most copies under one badge. */
	maxGroup?: number;
	/** Drawing area the badges must stay in. */
	bounds: { x0: number; y0: number; x1: number; y1: number };
}

export interface BadgePlacement {
	slug: string;
	/** Items this badge stands for (one, or several for a group). */
	ids: number[];
	x: number;
	y: number;
	r: number;
	/** True when the badge sits outside its part(s), joined by leaders. */
	outside: boolean;
	/** Where each leader ends (the pole of each item); empty for inside badges. */
	anchors: Pt[];
	/** Start of each leader on the badge rim, same order as `anchors`. */
	leaders: [Pt, Pt][];
}

/** Evenodd point-in-rings test. */
export function inRings(p: Pt, rings: readonly (readonly Pt[])[]): boolean {
	let inside = false;
	for (const rg of rings) {
		for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
			const a = rg[i];
			const b = rg[j];
			if (
				a[1] > p[1] !== b[1] > p[1] &&
				p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
			)
				inside = !inside;
		}
	}
	return inside;
}

function ringsBox(rings: readonly (readonly Pt[])[]) {
	let x0 = Infinity,
		y0 = Infinity,
		x1 = -Infinity,
		y1 = -Infinity;
	for (const rg of rings)
		for (const [x, y] of rg) {
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
	return { x0, y0, x1, y1 };
}

const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function layoutBadges(items: readonly BadgeItem[], opts: BadgeOptions): BadgePlacement[] {
	const { rMin, rMax, bounds } = opts;
	const fill = opts.fill ?? 0.5;
	const gap = opts.gap ?? rMin * 0.35;
	const clusterDist = opts.clusterDist ?? rMax * 5;
	const maxGroup = opts.maxGroup ?? 6;

	const boxes = items.map((it) => ringsBox(it.rings));
	const out: BadgePlacement[] = [];
	const small: BadgeItem[] = [];

	// 1. inside badges, scaled to the part
	for (const it of items) {
		const fit = it.inr * fill;
		if (fit >= rMin) {
			out.push({
				slug: it.slug,
				ids: [it.id],
				x: it.pole[0],
				y: it.pole[1],
				r: Math.min(rMax, fit),
				outside: false,
				anchors: [],
				leaders: []
			});
		} else small.push(it);
	}

	// 2. group small copies of one part that sit close together
	const groups: BadgeItem[][] = [];
	for (const it of small) {
		const g = groups.find(
			(grp) =>
				grp[0].slug === it.slug &&
				grp.length < maxGroup &&
				near(grp[0].pole, it.pole) <= clusterDist
		);
		if (g) g.push(it);
		else groups.push([it]);
	}

	// 3. outside badges, biggest groups first (they are the hardest to place)
	groups.sort((a, b) => b.length - a.length);
	const placed = out.map((b) => ({ x: b.x, y: b.y, r: b.r }));
	const blocked = (x: number, y: number, r: number): boolean => {
		if (x - r < bounds.x0 || x + r > bounds.x1 || y - r < bounds.y0 || y + r > bounds.y1)
			return true;
		for (const p of placed) if (Math.hypot(p.x - x, p.y - y) < p.r + r + gap) return true;
		const m = r + gap;
		for (let i = 0; i < items.length; i++) {
			const b = boxes[i];
			if (x + m < b.x0 || x - m > b.x1 || y + m < b.y0 || y - m > b.y1) continue;
			const rings = items[i].rings;
			if (inRings([x, y], rings)) return true;
			// the badge rim, with a margin, must stay clear as well
			for (let k = 0; k < 12; k++) {
				const a = (k / 12) * Math.PI * 2;
				if (inRings([x + Math.cos(a) * m, y + Math.sin(a) * m], rings)) return true;
			}
		}
		return false;
	};

	for (const grp of groups) {
		const r = rMin;
		const cx = grp.reduce((a, it) => a + it.pole[0], 0) / grp.length;
		const cy = grp.reduce((a, it) => a + it.pole[1], 0) / grp.length;
		// prefer the side facing the open area: away from the group's spread, otherwise up
		let best: { x: number; y: number; score: number } | null = null;
		const step = r * 0.5;
		for (let d = 0; d <= rMax * 14 && !best; d += step) {
			const n = d === 0 ? 1 : 24;
			for (let k = 0; k < n; k++) {
				const a = -Math.PI / 2 + (k / n) * Math.PI * 2;
				const x = cx + Math.cos(a) * d;
				const y = cy + Math.sin(a) * d;
				if (blocked(x, y, r)) continue;
				// closest to every copy wins; a long leader costs more than a far badge
				const score = grp.reduce((s, it) => s + near([x, y], it.pole), 0);
				if (!best || score < best.score) best = { x, y, score };
			}
			// keep searching one more ring after the first hit: a later ring can be closer overall
			if (best && d > 0) {
				for (let k = 0; k < 24; k++) {
					const a = -Math.PI / 2 + (k / 24) * Math.PI * 2;
					const x = cx + Math.cos(a) * (d + step);
					const y = cy + Math.sin(a) * (d + step);
					if (blocked(x, y, r)) continue;
					const score = grp.reduce((s, it) => s + near([x, y], it.pole), 0);
					if (score < best.score) best = { x, y, score };
				}
			}
		}
		// nowhere free: sit on the anchor like an inside badge (overlap is the lesser evil)
		const x = best?.x ?? cx;
		const y = best?.y ?? cy;
		placed.push({ x, y, r });
		const anchors = grp.map((it) => it.pole);
		out.push({
			slug: grp[0].slug,
			ids: grp.map((it) => it.id),
			x,
			y,
			r,
			outside: !!best,
			anchors: best ? anchors : [],
			leaders: best
				? anchors.map((p) => {
						const dd = near([x, y], p) || 1;
						return [[x + ((p[0] - x) / dd) * r, y + ((p[1] - y) / dd) * r], p] as [Pt, Pt];
					})
				: []
		});
	}
	return out;
}
