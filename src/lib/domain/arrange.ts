/**
 * Plate arranger: decides which parts go on which plate for a given printer bed,
 * grouped by filament, and where on the plate they sit. Pure, deterministic and
 * framework-free (no DB, Node or Svelte). See `arrange.README.md` for the data flow
 * and how a 3MF exporter consumes the result.
 *
 * Coordinates: millimetres, origin at the bed's front-left corner, x right, y
 * away from the viewer (y up in plan view). `ArrangedItem.x/y` is the CENTRE of the
 * item's footprint box after rotation; `rotation` is 0 or 90 degrees counter-clockwise
 * about z, applied to the stored mesh (whose box centre is at its origin) before moving
 * it to (x, y). Items never overlap and stay inside bed minus `margin`, with at least
 * `spacing` between neighbours (rectangle packing of each item's turned outline box).
 *
 * Algorithm: parts sharing a filament role (and run count) form one pool, sorted by
 * area, descending. Each keep-together block (a part, or parts with the same `group`) goes
 * on the fullest plate it fits (MaxRects, best short side fit, 0/90 rotation), else
 * a new plate; a block too large for one bed is split item by item. Afterwards
 * underfilled plates are merged whenever the printer's multi-material slots allow
 * and the materials are compatible (PETG never shares a plate with TPU).
 *
 * HARD RULE (maintainer, 2026-11-04; the 3D code was removed 2026-11-11): parts are never
 * re-oriented in 3D. They keep the face-down orientation of their source file; the arranger
 * only rotates them flat about z (0/90 degrees or a free in-plane angle). A part that does
 * not fit flat is reported as oversize. There is no code that can tilt or stand a part up.
 */
import { boxOrients, fitOutline, rotatePoints, turnedOutlineBox, type Pt } from './geom2d.ts';
import { findFreePosition, optimizeLayout, type OptItem } from './plate-optimize.ts';
import {
	GROUP_VERSION,
	groupFit,
	type PrintFootprint,
	type SourceGroup
} from './print-footprint.ts';
import type { Silhouette } from './silhouette.ts';
import type { BuildPrinter } from './types.ts';

export interface ArrangeRole {
	key: string;
	/** Short label used in plate names, e.g. "Accent". */
	name: string;
	/** "PETG", "TPU 95A", ... Plates can only mix roles of the same material family. */
	material: string;
	tpu?: boolean;
}

export interface ArrangePart {
	slug: string;
	name: string;
	/** ArrangeRole.key of the filament this part is printed in. */
	role: string;
	footprint: PrintFootprint;
	/** Units needed in total (the part's quantity; 1 for sets such as tires). */
	units: number;
	/** Parts with the same non-empty group (same role) prefer one plate: left/right pairs, components. */
	group?: string | null;
	/** Grams per unit, when known. */
	grams?: number | null;
	/** Allow turning the part about z: 0/90 degrees first, a free angle only when nothing else fits. Default true. */
	rotate?: boolean;
	/** Extra advice appended to an oversize warning, e.g. "Choose the two-piece footrest." */
	hint?: string | null;
}

export interface ArrangeUnsized {
	slug: string;
	name: string;
	role: string;
	grams?: number | null;
}

export interface ArrangePrinter {
	bedX: number;
	bedY: number;
	/** Build volume height (used by the export guard). */
	bedZ?: number;
	/** Keep-out border around the bed edge. */
	margin: number;
	/** Gap between parts. */
	spacing: number;
	/** Filaments one plate may use. */
	mmSlots: number;
	/** Rectangles of the bed parts must stay out of (bed mm, origin front-left); the margin is kept around them too. */
	keepOut?: { x: number; y: number; w: number; d: number; label?: string }[];
}

export interface ArrangeOptions {
	/** Merge phase only touches plates below this utilisation (0..1). Default 0.6. */
	mergeBelow?: number;
	/** Move and turn items on their plate for edge clearance after packing (plate-optimize.ts). Default true. */
	optimize?: boolean;
	/** Override which roles may share a plate (still limited by mmSlots). */
	compatible?: (a: ArrangeRole, b: ArrangeRole) => boolean;
}

export interface ArrangeInput {
	parts: ArrangePart[];
	/** Parts without geometry; each gets its own plate with no positions. */
	unsized?: ArrangeUnsized[];
	roles: ArrangeRole[];
	printer: ArrangePrinter;
	options?: ArrangeOptions;
}

export interface ArrangedItem {
	slug: string;
	/** Index into the part footprint's `pieces`. */
	piece: number;
	/** 0-based copy number of this piece on the plate (per part). */
	copy: number;
	/** Centre of the placed box, bed coordinates (mm). */
	x: number;
	y: number;
	/** Placed box size after rotation. */
	w: number;
	d: number;
	/** Degrees counter-clockwise about z, applied to the mesh before moving it to (x, y). 0 or 90 normally; any angle when the part only fits the bed turned (hull-based). */
	rotation: number;
	role: string;
	/** Where the turned mesh's box centre lies relative to its origin; the mesh is moved to (x - ox, y - oy). Absent for 0/90 degrees. */
	ox?: number;
	oy?: number;
	/** Response only (GET /arrangement): key into ArrangementInfo.silhouettes for this item's outline. */
	sil?: string;
	/**
	 * Set on items that belong to a rigid source group (pieces laid out as in the kit author's profile):
	 * items with the same number on a plate were placed, turned and moved together.
	 */
	group?: number;
}

export interface ArrangedPlate {
	number: number;
	name: string;
	items: ArrangedItem[];
	/** Part slugs on the plate, in first-appearance order. */
	parts: string[];
	roles: string[];
	/** Times the plate is printed (rims: 2). */
	runs: number;
	/** Estimated grams per run by role key. */
	estGrams: Record<string, number>;
	/** Footprint area / usable bed area, 0..1. */
	utilisation: number;
	/** True when a part is bigger than the bed; its items are centred and overhang. */
	oversize?: boolean;
	bed: {
		x: number;
		y: number;
		margin: number;
		keepOut?: { x: number; y: number; w: number; d: number; label?: string }[];
	};
}

export type ArrangeWarningCode = 'oversize' | 'split' | 'unsized' | 'unknown-role';
export interface ArrangeWarning {
	code: ArrangeWarningCode;
	slug: string;
	message: string;
}

export interface ArrangeResult {
	plates: ArrangedPlate[];
	warnings: ArrangeWarning[];
}

// ---- MaxRects bin

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

class MaxRects {
	free: Rect[];
	used = 0;
	constructor(
		readonly W: number,
		readonly H: number
	) {
		this.free = [{ x: 0, y: 0, w: W, h: H }];
	}
	clone(): MaxRects {
		const c = new MaxRects(this.W, this.H);
		c.free = this.free.map((r) => ({ ...r }));
		c.used = this.used;
		return c;
	}
	/** Best short side fit over the candidate sizes; returns the placed rect and the chosen candidate index. */
	insert(sizes: { w: number; h: number }[]): (Rect & { idx: number }) | null {
		let best: (Rect & { idx: number }) | null = null;
		let bs = Infinity;
		let bl = Infinity;
		const E = 1e-6;
		for (const f of this.free) {
			for (let idx = 0; idx < sizes.length; idx++) {
				const rw = sizes[idx].w;
				const rh = sizes[idx].h;
				if (rw > f.w + E || rh > f.h + E) continue;
				const short = Math.min(f.w - rw, f.h - rh);
				const long = Math.max(f.w - rw, f.h - rh);
				const better =
					short < bs - E ||
					(Math.abs(short - bs) <= E && long < bl - E) ||
					(Math.abs(short - bs) <= E &&
						Math.abs(long - bl) <= E &&
						best !== null &&
						(f.y < best.y - E || (Math.abs(f.y - best.y) <= E && f.x < best.x - E)));
				if (better) {
					best = { x: f.x, y: f.y, w: rw, h: rh, idx };
					bs = short;
					bl = long;
				}
			}
		}
		if (!best) return null;
		this.place(best);
		this.used += best.w * best.h;
		return best;
	}
	/** Reserve a rectangle that no item may overlap (keep-out areas). */
	block(r: Rect) {
		const x0 = Math.max(0, r.x);
		const y0 = Math.max(0, r.y);
		const x1 = Math.min(this.W, r.x + r.w);
		const y1 = Math.min(this.H, r.y + r.h);
		if (x1 > x0 && y1 > y0) this.place({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
	}
	private place(r: Rect) {
		const out: Rect[] = [];
		for (const f of this.free) {
			if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) {
				out.push(f);
				continue;
			}
			if (r.x > f.x) out.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
			if (r.x + r.w < f.x + f.w)
				out.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
			if (r.y > f.y) out.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
			if (r.y + r.h < f.y + f.h)
				out.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
		}
		// prune rectangles contained in another
		const keep: Rect[] = [];
		for (let i = 0; i < out.length; i++) {
			const a = out[i];
			let inside = false;
			for (let j = 0; j < out.length && !inside; j++) {
				if (i === j) continue;
				const b = out[j];
				const contained =
					a.x >= b.x - 1e-9 &&
					a.y >= b.y - 1e-9 &&
					a.x + a.w <= b.x + b.w + 1e-9 &&
					a.y + a.h <= b.y + b.h + 1e-9;
				if (contained && (a.w < b.w || a.h < b.h || j < i)) inside = true;
			}
			if (!inside && a.w > 1e-9 && a.h > 1e-9) keep.push(a);
		}
		this.free = keep;
	}
}

// ---- internals

/** A placement candidate: box after turning by `rot` degrees about z. */
interface Orient {
	w: number;
	d: number;
	rot: number;
	/** Centre of the turned outline relative to the mesh origin (free angles only). */
	ox?: number;
	oy?: number;
}

interface Item {
	slug: string;
	piece: number;
	copy: number;
	/** Candidate placements: bounding box after turning by `rot` degrees. First entries are preferred on ties. */
	orients: Orient[];
	/** Unrotated box (for area ordering). */
	w: number;
	d: number;
	role: string;
	order: number; // index of the part in the input
	ox?: number;
	oy?: number;
	/** A rigid group of pieces (source layout): one packing item standing for all `members`. */
	grp?: { g: SourceGroup; members: Item[] };
	/** Source group this item came from (also when the group had to be broken up), for the split note. */
	src?: string;
}

interface PlateState {
	bin: MaxRects;
	items: (Item & {
		x: number;
		y: number;
		pw: number;
		pd: number;
		rot: number;
		ox?: number;
		oy?: number;
	})[];
	roles: Set<string>;
	runs: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const area = (i: { w: number; d: number }) => i.w * i.d;

function itemOrder(a: Item, b: Item): number {
	return area(b) - area(a) || a.order - b.order || a.piece - b.piece || a.copy - b.copy;
}

function family(r: ArrangeRole): string {
	if (r.tpu || /^\s*(tpu|tpe|flex)/i.test(r.material)) return 'tpu';
	return (/^[A-Za-z]+/.exec(r.material.trim())?.[0] ?? r.material).toUpperCase();
}
const defaultCompatible = (a: ArrangeRole, b: ArrangeRole) => family(a) === family(b);

const SIDE = /\b(left|right)\b/i;
function pluralize(s: string): string {
	return /s$/i.test(s) ? s : `${s}s`;
}

/** "Wing Left" + "Wing Right" -> "Wings"; joins up to three names. Exported for tests. */
export function plateTitle(names: string[]): string {
	const bases = new Map<string, Set<string>>();
	const order: string[] = [];
	for (const n of names) {
		const m = SIDE.exec(n);
		const base = n
			.replace(SIDE, '')
			.replace(/\s{2,}/g, ' ')
			.trim();
		const key = m ? base : n;
		if (!bases.has(key)) {
			bases.set(key, new Set());
			order.push(key);
		}
		if (m) bases.get(key)!.add(m[1].toLowerCase());
	}
	const labels = order.map((k) => {
		const sides = bases.get(k)!;
		if (sides.size === 2) {
			// keep a trailing qualifier "(McMaster)" after the plural
			const paren = /^(.*?)\s*(\([^)]*\))$/.exec(k);
			return paren ? `${pluralize(paren[1])} ${paren[2]}` : pluralize(k);
		}
		return (
			names.find(
				(n) =>
					n
						.replace(SIDE, '')
						.replace(/\s{2,}/g, ' ')
						.trim() === k
			) ?? k
		);
	});
	if (labels.length <= 1) return labels[0] ?? '';
	if (labels.length === 2) return `${labels[0]} + ${labels[1]}`;
	if (labels.length === 3) return `${labels[0]}, ${labels[1]} + ${labels[2]}`;
	return `${labels[0]}, ${labels[1]} + ${labels.length - 2} more`;
}

/** Placement candidates for a box (see `boxOrients`). Exported for tests. */
export const orientsOf = boxOrients;

/**
 * Arrange parts onto plates for a printer. Pieces are packed one by one (densest); the rigid source
 * group of a part (pieces laid out as in the kit author's profile) is used only for parts that
 * per-piece packing would split over plates, and only when that gives fewer plates, or the same
 * number with fewer split parts. Ties keep the per-piece layout. Two deterministic passes at most.
 */
export function arrange(input: ArrangeInput): ArrangeResult {
	const withGroups = input.parts.filter((p) => p.footprint.groups?.length);
	if (!withGroups.length) return arrangeCore(input);
	const strip = (parts: ArrangePart[], keep: Set<string>) =>
		parts.map((p) =>
			p.footprint.groups && !keep.has(p.slug)
				? { ...p, footprint: { ...p.footprint, groups: undefined } }
				: p
		);
	const base = arrangeCore({ ...input, parts: strip(input.parts, new Set()) });
	const split = new Set(base.warnings.filter((w) => w.code === 'split').map((w) => w.slug));
	const need = new Set(withGroups.map((p) => p.slug).filter((s) => split.has(s)));
	if (!need.size) return base;
	const alt = arrangeCore({ ...input, parts: strip(input.parts, need) });
	const splits = (r: ArrangeResult) => r.warnings.filter((w) => w.code === 'split').length;
	return alt.plates.length < base.plates.length ||
		(alt.plates.length === base.plates.length && splits(alt) < splits(base))
		? alt
		: base;
}

function arrangeCore(input: ArrangeInput): ArrangeResult {
	const { printer } = input;
	const warnings: ArrangeWarning[] = [];
	const spacing = Math.max(0, printer.spacing);
	const margin = Math.max(0, printer.margin);
	const usableX = Math.max(0, printer.bedX - 2 * margin);
	const usableY = Math.max(0, printer.bedY - 2 * margin);
	const binW = usableX + spacing;
	const binH = usableY + spacing;
	const mergeBelow = input.options?.mergeBelow ?? 0.6;
	const compat = input.options?.compatible ?? defaultCompatible;
	const slots = Math.max(1, Math.floor(printer.mmSlots || 1));
	const roleOf = new Map(input.roles.map((r) => [r.key, r]));
	const roleIndex = new Map(input.roles.map((r, i) => [r.key, i]));
	const fallbackRole = (key: string): ArrangeRole => ({ key, name: key, material: 'PETG' });
	const getRole = (key: string) => roleOf.get(key) ?? fallbackRole(key);

	const canShare = (keys: Iterable<string>): boolean => {
		const list = [...new Set(keys)].map(getRole);
		if (list.length > slots) return false;
		for (let i = 0; i < list.length; i++)
			for (let j = i + 1; j < list.length; j++) if (!compat(list[i], list[j])) return false;
		return true;
	};

	const parts = input.parts;
	const partIndex = new Map(parts.map((p, i) => [p.slug, i]));
	const partOf = new Map(parts.map((p) => [p.slug, p]));
	const runsOf = (p: ArrangePart) => {
		const per = Math.max(1, p.footprint.unitsPerPlate ?? p.units);
		return Math.max(1, Math.ceil(Math.max(1, p.units) / per));
	};
	const unitsPerRun = (p: ArrangePart) =>
		Math.min(Math.max(1, p.units), Math.max(1, p.footprint.unitsPerPlate ?? p.units));
	const itemsPerRun = (p: ArrangePart) =>
		p.footprint.pieces.reduce((a, pc) => a + Math.max(1, pc.copies), 0) * unitsPerRun(p);

	// 1. items per part (one run's worth)
	const itemsOf = new Map<string, Item[]>();
	for (const p of parts) {
		if (!roleOf.has(p.role))
			warnings.push({
				code: 'unknown-role',
				slug: p.slug,
				message: `${p.name} uses a filament ("${p.role}") that is not set up for this build.`
			});
		const list: Item[] = [];
		const up = unitsPerRun(p);
		p.footprint.pieces.forEach((pc, pi) => {
			const n = Math.max(1, pc.copies) * up;
			for (let c = 0; c < n; c++)
				list.push({
					slug: p.slug,
					piece: pi,
					copy: c,
					w: pc.w,
					d: pc.d,
					orients: boxOrients(pc, p.rotate !== false, usableX, usableY),
					role: p.role,
					order: partIndex.get(p.slug)!
				});
		});
		itemsOf.set(p.slug, list);
	}

	/** Empty bin with the keep-out areas (plus the edge margin around them) reserved. */
	const emptyBin = (): MaxRects => {
		const bin = new MaxRects(binW, binH);
		for (const z of zones) {
			// item box [x, x + w] (bin coordinates = bed - margin) must end before zone.x - 2 * margin or start after zone.x + zone.w
			const x0 = z.x - 2 * margin + spacing;
			const y0 = z.y - 2 * margin + spacing;
			const x1 = z.x + z.w;
			const y1 = z.y + z.d;
			bin.block({ x: x0, y: y0, w: Math.max(x1 - x0, 0.01), h: Math.max(y1 - y0, 0.01) });
		}
		return bin;
	};
	const zones = (printer.keepOut ?? []).filter((z) => z.w > 0 && z.d > 0);
	const newPlate = (runs: number): PlateState => ({
		bin: emptyBin(),
		items: [],
		roles: new Set(),
		runs
	});

	/** Place items on a clone of `plate`; returns the new state or null when they do not all fit. */
	function tryPlace(plate: PlateState, items: Item[]): PlateState | null {
		const next: PlateState = {
			bin: plate.bin.clone(),
			items: [...plate.items],
			roles: new Set(plate.roles),
			runs: plate.runs
		};
		for (const it of [...items].sort(itemOrder)) {
			const r = next.bin.insert(it.orients.map((o) => ({ w: o.w + spacing, h: o.d + spacing })));
			if (!r) return null;
			const o = it.orients[r.idx];
			next.items.push({
				...it,
				x: r.x,
				y: r.y,
				pw: o.w,
				pd: o.d,
				rot: o.rot,
				ox: o.ox,
				oy: o.oy
			});
			next.roles.add(it.role);
		}
		return next;
	}

	const fitsEmptyBed = (it: Item): boolean =>
		it.orients.some((o) => o.w <= usableX + 1e-6 && o.d <= usableY + 1e-6);
	// with keep-out areas a box that fits the bed may still have no free spot
	const fitsEmpty = (it: Item): boolean =>
		zones.length ? tryPlace(newPlate(1), [it]) !== null : fitsEmptyBed(it);

	// 2. oversize parts get their own plate
	const plates: PlateState[] = [];
	const oversizePlates: { part: ArrangePart; items: Item[] }[] = [];
	const normal: ArrangePart[] = [];
	const itemOutline = (it: Item): Pt[] =>
		it.grp
			? fitOutline(groupFit(it.grp.g))
			: fitOutline(partOf.get(it.slug)!.footprint.pieces[it.piece]);
	/** Outline-based spot for an item whose box has none around the keep-out areas (diagonal wings). */
	const soloSpot = (it: Item) => {
		const outline = itemOutline(it);
		const setup = { bedX: printer.bedX, bedY: printer.bedY, margin, spacing, keepOut: zones };
		let best: { o: Orient; x: number; y: number; clearance: number } | null = null;
		for (const o of it.orients) {
			const pos = findFreePosition(
				outline,
				o.rot,
				setup,
				o.ox !== undefined || o.oy !== undefined ? { ox: o.ox ?? 0, oy: o.oy ?? 0 } : undefined
			);
			if (pos && (!best || pos.clearance > best.clearance)) best = { o, ...pos };
		}
		if (best) return best;
		// the fitter's few candidate angles have no spot: sweep every 0.25 degrees for angles whose
		// box fits the bed, tightest slack last, and look for a spot around the keep-out areas
		const cand: { deg: number; slack: number }[] = [];
		for (let k = 0; k < 1440; k++) {
			const deg = k * 0.25;
			const b = turnedOutlineBox(outline, deg);
			const slack = Math.min(usableX - b.w, usableY - b.d);
			if (slack >= -1e-6) cand.push({ deg, slack });
		}
		cand.sort((a, b) => b.slack - a.slack || a.deg - b.deg);
		for (const { deg } of cand.slice(0, 120)) {
			const b = turnedOutlineBox(outline, deg);
			const axis = deg % 90 === 0;
			const o: Orient = {
				w: Math.ceil(b.w * 10 - 1e-9) / 10,
				d: Math.ceil(b.d * 10 - 1e-9) / 10,
				rot: deg,
				...(axis ? {} : { ox: Math.round(b.cx * 100) / 100, oy: Math.round(b.cy * 100) / 100 })
			};
			const pos = findFreePosition(
				outline,
				deg,
				setup,
				axis ? undefined : { ox: o.ox!, oy: o.oy! }
			);
			if (pos && (!best || pos.clearance > best.clearance + 1e-9)) best = { o, ...pos };
		}
		return best;
	};
	// 2a. parts whose pieces shared a plate in the kit author's profile stay together: the stored
	// group goes in as one rigid item when it fits the bed; otherwise its pieces are packed one by one
	const partsWithGroups = new Set<string>();
	for (const p of parts) {
		const list = itemsOf.get(p.slug)!;
		const groups = (p.footprint.groups ?? []).filter(
			(g) => g.v === GROUP_VERSION && g.items.length >= 2
		);
		if (!groups.length) continue;
		// every group object must be one the part calls for (copies x units per run); else ignore the data
		const want = new Map<number, number>();
		for (const it of list) want.set(it.piece, (want.get(it.piece) ?? 0) + 1);
		const have = new Map<number, number>();
		let valid = true;
		for (const g of groups)
			for (const m of g.items) {
				if (!p.footprint.pieces[m.piece]) valid = false;
				have.set(m.piece, (have.get(m.piece) ?? 0) + 1);
			}
		for (const [pc, n] of have) if (n > (want.get(pc) ?? 0)) valid = false;
		if (!valid) continue;
		partsWithGroups.add(p.slug);
		const taken = new Set<Item>();
		const added: Item[] = [];
		groups.forEach((g, gi) => {
			const members: Item[] = g.items.map((m) => {
				const it = list.find((x) => x.piece === m.piece && !taken.has(x))!;
				taken.add(it);
				return it;
			});
			members.forEach((m) => (m.src = `g${gi}`));
			const gItem: Item = {
				slug: p.slug,
				piece: -1,
				copy: gi,
				w: g.w,
				d: g.d,
				orients: boxOrients(groupFit(g), p.rotate !== false, usableX, usableY),
				role: p.role,
				order: partIndex.get(p.slug)!,
				grp: { g, members },
				src: `g${gi}`
			};
			if (fitsEmpty(gItem) || (zones.length > 0 && soloSpot(gItem))) {
				members.forEach((m) => taken.add(m));
				added.push(gItem);
			} else members.forEach((m) => taken.delete(m));
		});
		const brokenOut = new Set<Item>();
		for (const a of added) for (const m of a.grp!.members) brokenOut.add(m);
		itemsOf.set(p.slug, [...added, ...list.filter((x) => !brokenOut.has(x))]);
	}

	for (const p of parts) {
		let items = itemsOf.get(p.slug)!;
		if (zones.length) {
			const keep: Item[] = [];
			for (const it of items) {
				const spot = fitsEmpty(it) ? null : soloSpot(it);
				if (!spot) {
					keep.push(it);
					continue;
				}
				// own plate: placed by its outline, the keep-out corner is inside the box but not the part
				const bin = emptyBin();
				bin.used = usableX * usableY;
				plates.push({
					bin,
					items: [
						{
							...it,
							x: spot.x - margin - spot.o.w / 2,
							y: spot.y - margin - spot.o.d / 2,
							pw: spot.o.w,
							pd: spot.o.d,
							rot: spot.o.rot,
							ox: spot.o.ox,
							oy: spot.o.oy
						}
					],
					roles: new Set([it.role]),
					runs: runsOf(p)
				});
			}
			items = keep;
			itemsOf.set(p.slug, keep);
		}
		const bad = items.find((i) => !fitsEmpty(i));
		if (bad || !items.length) {
			if (bad) items = items.flatMap((i) => (i.grp ? i.grp.members : [i]));
			if (bad) {
				const big = items.reduce((a, b) => (area(b) > area(a) ? b : a));
				const hasOutline =
					!!p.footprint.pieces[bad.piece]?.sil || !!p.footprint.pieces[bad.piece]?.hull;
				const zoneOnly = zones.length > 0 && fitsEmptyBed(bad);
				const zoneNames = [...new Set(zones.map((z) => z.label || 'keep-out area'))].join(', ');
				const advice = zoneOnly
					? ` It fits the bed but not around the ${zoneNames} area that parts must keep clear of. Print it from another profile, on a bigger bed, or as a smaller variant.`
					: p.rotate === false
						? ''
						: ` No flat angle of its ${hasOutline ? 'outline' : 'box'} fits. Print it from another profile, on a bigger bed, or as a smaller variant (for example a two-piece version).`;
				warnings.push({
					code: 'oversize',
					slug: p.slug,
					message:
						`${p.name} ${Math.round(Math.max(big.w, big.d))}×${Math.round(Math.min(big.w, big.d))} mm doesn't fit a ` +
						`${printer.bedX}×${printer.bedY} mm bed${zoneOnly ? ' with its keep-out area' : p.rotate === false ? '' : ' even rotated'}.` +
						advice +
						(p.hint ? ` ${p.hint}` : '')
				});
				oversizePlates.push({ part: p, items });
			}
			continue;
		}
		normal.push(p);
	}

	// 3. pack each (runs, role) pool
	const pools = new Map<string, ArrangePart[]>();
	for (const p of normal) {
		const k = `${runsOf(p)}|${p.role}`;
		if (!pools.has(k)) pools.set(k, []);
		pools.get(k)!.push(p);
	}
	const poolKeys = [...pools.keys()].sort((a, b) => {
		const [ra, rolea] = a.split('|');
		const [rb, roleb] = b.split('|');
		return (
			(roleIndex.get(rolea) ?? 999) - (roleIndex.get(roleb) ?? 999) ||
			Number(ra) - Number(rb) ||
			a.localeCompare(b)
		);
	});
	const platesByRuns = new Map<number, PlateState[]>();

	for (const key of poolKeys) {
		const pool = pools.get(key)!;
		const runs = runsOf(pool[0]);
		const list = platesByRuns.get(runs) ?? [];
		platesByRuns.set(runs, list);
		const mine: PlateState[] = [];
		// blocks: parts sharing a group stay together
		const blocks = new Map<string, ArrangePart[]>();
		for (const p of pool) {
			const bk = p.group ? `g:${p.group}` : `p:${p.slug}`;
			if (!blocks.has(bk)) blocks.set(bk, []);
			blocks.get(bk)!.push(p);
		}
		const ordered = [...blocks.values()].sort((a, b) => {
			const aa = a.reduce((s, p) => s + itemsOf.get(p.slug)!.reduce((t, i) => t + area(i), 0), 0);
			const ab = b.reduce((s, p) => s + itemsOf.get(p.slug)!.reduce((t, i) => t + area(i), 0), 0);
			return ab - aa || partIndex.get(a[0].slug)! - partIndex.get(b[0].slug)!;
		});
		for (const block of ordered) {
			const items = block.flatMap((p) => itemsOf.get(p.slug)!);
			// fullest existing plate that takes the whole block
			let target: PlateState | null = null;
			let targetIdx = -1;
			let bestUsed = -1;
			mine.forEach((pl, idx) => {
				const t = tryPlace(pl, items);
				if (t && t.bin.used > bestUsed) {
					bestUsed = t.bin.used;
					target = t;
					targetIdx = idx;
				}
			});
			if (target) {
				mine[targetIdx] = target;
				continue;
			}
			const fresh = tryPlace(newPlate(runs), items);
			if (fresh) {
				mine.push(fresh);
				continue;
			}
			// does not fit on one bed: split item by item, fullest plate first
			for (const it of [...items].sort(itemOrder)) {
				let t2: PlateState | null = null;
				let idx2 = -1;
				let used2 = -1;
				mine.forEach((pl, idx) => {
					const t = tryPlace(pl, [it]);
					if (t && t.bin.used > used2) {
						used2 = t.bin.used;
						t2 = t;
						idx2 = idx;
					}
				});
				if (t2) mine[idx2] = t2;
				else mine.push(tryPlace(newPlate(runs), [it])!);
			}
		}
		list.push(...mine);
	}

	// 4. merge underfilled plates (multi-material)
	const utilOf = (pl: PlateState) =>
		usableX * usableY > 0 ? pl.items.reduce((a, i) => a + i.w * i.d, 0) / (usableX * usableY) : 0;
	for (const [runs, list] of platesByRuns) {
		let changed = true;
		while (changed) {
			changed = false;
			const idxs = list.map((_, i) => i).sort((a, b) => utilOf(list[a]) - utilOf(list[b]) || a - b);
			outer: for (const a of idxs) {
				for (const b of [...idxs].reverse()) {
					if (a === b) continue;
					const A = list[a];
					const B = list[b];
					if (utilOf(A) >= mergeBelow && utilOf(B) >= mergeBelow) continue;
					if (!canShare([...A.roles, ...B.roles])) continue;
					const merged = tryPlace(newPlate(runs), [...A.items, ...B.items]);
					if (!merged) continue;
					const lo = Math.min(a, b);
					list.splice(Math.max(a, b), 1);
					list[lo] = merged;
					changed = true;
					break outer;
				}
			}
		}
		plates.push(...list);
	}

	// 5. order, name, convert
	const sortKey = (pl: PlateState) => {
		const roleRank = Math.min(...[...pl.roles].map((r) => roleIndex.get(r) ?? 999));
		const firstPart = Math.min(...pl.items.map((i) => i.order));
		return [roleRank, firstPart, pl.runs];
	};
	plates.sort((a, b) => {
		const ka = sortKey(a);
		const kb = sortKey(b);
		return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
	});

	const result: ArrangedPlate[] = [];
	const bedInfo = {
		x: printer.bedX,
		y: printer.bedY,
		margin,
		...(zones.length ? { keepOut: zones.map((z) => ({ ...z })) } : {})
	};
	/** Post-packing pass: same items on the same plate, better positions and angles (see plate-optimize.ts). */
	const optimizeItems = (items: ArrangedItem[], raw: Item[]) => {
		// `raw` is aligned with `items`; a rigid group moves and turns as one item (its outline is the hull of all its pieces)
		const opt: OptItem[] = items.map((i, k) => {
			const free = i.rotation % 90 !== 0;
			return {
				outline: itemOutline(raw[k]),
				rotatable: free && partOf.get(i.slug)!.rotate !== false,
				angles: raw[k].orients.map((o) => o.rot),
				rot: i.rotation,
				x: i.x,
				y: i.y,
				ox: i.ox,
				oy: i.oy,
				w: i.w,
				d: i.d
			};
		});
		const out = optimizeLayout(opt, {
			bedX: printer.bedX,
			bedY: printer.bedY,
			margin,
			spacing,
			keepOut: zones
		});
		out.forEach((o, k) => {
			const it = items[k];
			it.x = round1(o.x);
			it.y = round1(o.y);
			it.w = round1(o.w);
			it.d = round1(o.d);
			it.rotation = o.rot;
			if (o.ox || o.oy) {
				it.ox = o.ox;
				it.oy = o.oy;
			} else {
				delete it.ox;
				delete it.oy;
			}
		});
	};
	/** Which source group (or single object) an arranged item came from: for the split note. */
	const srcOf = new WeakMap<ArrangedItem, string>();
	const toPlate = (
		pl: PlateState | null,
		fallback?: { part: ArrangePart; items: Item[] }
	): ArrangedPlate => {
		const rawItems = pl
			? pl.items
			: fallback!.items.map((i) => ({ ...i, x: 0, y: 0, pw: i.w, pd: i.d, rot: 0 }));
		const runs = pl ? pl.runs : runsOf(fallback!.part);
		const units: ArrangedItem[] = rawItems
			.sort((a, b) => a.order - b.order || a.piece - b.piece || a.copy - b.copy)
			.map((i) => ({
				slug: i.slug,
				piece: i.piece,
				copy: i.copy,
				x: pl ? round1(margin + i.x + i.pw / 2) : round1(printer.bedX / 2),
				y: pl ? round1(margin + i.y + i.pd / 2) : round1(printer.bedY / 2),
				w: round1(i.pw),
				d: round1(i.pd),
				rotation: i.rot,
				role: i.role,
				...(i.ox || i.oy ? { ox: i.ox, oy: i.oy } : {})
			}));
		if (pl && input.options?.optimize !== false) optimizeItems(units, rawItems);
		const items: ArrangedItem[] = [];
		units.forEach((u, k) => {
			const r = rawItems[k];
			if (!r.grp) {
				items.push(u);
				srcOf.set(u, `${r.slug}|${r.src ?? `i${k}`}`);
				return;
			}
			// group origin = where the group's frame sits; every piece goes to origin + Rz(rotation) * offset
			const ang = (u.rotation * Math.PI) / 180;
			const c = Math.cos(ang);
			const sn = Math.sin(ang);
			const ox0 = u.x - (u.ox ?? 0);
			const oy0 = u.y - (u.oy ?? 0);
			const fp = partOf.get(u.slug)!.footprint;
			r.grp.g.items.forEach((gi, n) => {
				const m = r.grp!.members[n];
				const mx = ox0 + c * gi.x - sn * gi.y;
				const my = oy0 + sn * gi.x + c * gi.y;
				const rot = Math.round(((((u.rotation + gi.rot) % 360) + 360) % 360) * 1000) / 1000;
				const b = turnedOutlineBox(fitOutline(fp.pieces[gi.piece]), rot);
				const px = Math.round(b.cx * 100) / 100;
				const py = Math.round(b.cy * 100) / 100;
				const off = Math.abs(px) > 0.05 || Math.abs(py) > 0.05;
				const it: ArrangedItem = {
					slug: u.slug,
					piece: gi.piece,
					copy: m.copy,
					x: round1(mx + (off ? px : 0)),
					y: round1(my + (off ? py : 0)),
					w: round1(Math.ceil(b.w * 10 - 1e-9) / 10),
					d: round1(Math.ceil(b.d * 10 - 1e-9) / 10),
					rotation: rot,
					role: u.role,
					...(off ? { ox: px, oy: py } : {}),
					group: k
				};
				items.push(it);
				srcOf.set(it, `${u.slug}|${m.src ?? 'g'}`);
			});
		});
		const slugs: string[] = [];
		for (const i of items) if (!slugs.includes(i.slug)) slugs.push(i.slug);
		slugs.sort((a, b) => partIndex.get(a)! - partIndex.get(b)!);
		const roles = [...new Set(items.map((i) => i.role))].sort(
			(a, b) => (roleIndex.get(a) ?? 999) - (roleIndex.get(b) ?? 999)
		);
		const estGrams: Record<string, number> = {};
		for (const s of slugs) {
			const p = partOf.get(s)!;
			if (p.grams == null) continue;
			const share = items.filter((i) => i.slug === s).length / Math.max(1, itemsPerRun(p));
			estGrams[p.role] = round1((estGrams[p.role] ?? 0) + p.grams * unitsPerRun(p) * share);
		}
		const names = slugs.map((s) => partOf.get(s)!.name);
		let name = plateTitle(names);
		if (roles.length === 1) name += ` (${getRole(roles[0]).name})`;
		const util =
			usableX * usableY > 0 ? items.reduce((a, i) => a + i.w * i.d, 0) / (usableX * usableY) : 0;
		return {
			number: 0,
			name,
			items,
			parts: slugs,
			roles,
			runs,
			estGrams,
			utilisation: Math.min(1, Math.round(util * 100) / 100),
			...(pl ? {} : { oversize: true }),
			bed: bedInfo
		};
	};

	for (const pl of plates) result.push(toPlate(pl));
	for (const o of oversizePlates) result.push(toPlate(null, o));
	for (const u of input.unsized ?? []) {
		warnings.push({
			code: 'unsized',
			slug: u.slug,
			message: `${u.name} has no print size on file, so it gets its own plate without a layout.`
		});
		const g = u.grams != null ? { [u.role]: round1(u.grams) } : {};
		result.push({
			number: 0,
			name: `${u.name} (${getRole(u.role).name})`,
			items: [],
			parts: [u.slug],
			roles: [u.role],
			runs: 1,
			estGrams: g,
			utilisation: 0,
			bed: bedInfo
		});
	}
	result.forEach((p, i) => (p.number = i + 1));

	// 6. disambiguate repeated names and report split parts
	const nameCount = new Map<string, number>();
	for (const p of result) nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);
	const seen = new Map<string, number>();
	for (const p of result) {
		if ((nameCount.get(p.name) ?? 0) > 1) {
			const n = (seen.get(p.name) ?? 0) + 1;
			seen.set(p.name, n);
			p.name = `${p.name} ${n}/${nameCount.get(p.name)}`;
		}
	}
	const where = new Map<string, number[]>();
	for (const p of result)
		if (!p.oversize) for (const s of p.parts) where.set(s, [...(where.get(s) ?? []), p.number]);
	// A part built from source groups (its pieces came from different plates of the profile) may sit on
	// several plates; it is only "split" when one source group had to be broken up.
	const brokenGroups = new Set<string>();
	{
		const sources = new Map<string, Set<number>>();
		for (const p of result)
			for (const i of p.items) {
				const k = srcOf.get(i);
				if (!k || !k.includes('|g')) continue;
				sources.set(k, (sources.get(k) ?? new Set()).add(p.number));
			}
		for (const [k, nums] of sources) if (nums.size > 1) brokenGroups.add(k.split('|')[0]);
	}
	for (const [slug, nums] of where)
		if (nums.length > 1 && (!partsWithGroups.has(slug) || brokenGroups.has(slug)))
			warnings.push({
				code: 'split',
				slug,
				message: `${partOf.get(slug)?.name ?? slug} is split over plates ${nums.length > 2 ? `${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}` : nums.join(' and ')} because its copies do not fit one plate.`
			});
	return { plates: result, warnings };
}

/** Rotates a footprint hull (centred on its box centre) for display: rotation 0 or 90 degrees. */
export function placedHull(hull: readonly Pt[], rotation: number): Pt[] {
	return rotation === 0
		? hull.map((p) => [...p] as Pt)
		: rotatePoints(hull, (rotation * Math.PI) / 180);
}

/** Box size of a footprint after rotation (convenience for UI). */
export function placedSize(w: number, d: number, rotation: number) {
	return rotation % 180 === 0 ? { w, d } : rotation % 180 === 90 ? { w: d, d: w } : { w, d };
}

/** Response of GET /api/builds/[id]/arrangement (see arrange.README.md). */
export interface ArrangementInfo {
	printer: BuildPrinter | null;
	/** Plate layout currently applied ('arranged', a layout key, 'upload' or null). */
	layout: string | null;
	/** Stored positions of the build's plates (only plates with source 'arranged'). */
	plates: ArrangedPlate[];
	/** Fresh plan for the current colors, variants and printer (what "Arrange" would apply). */
	fresh: { plates: number; warnings: ArrangeWarning[]; unsized: string[] } | null;
	/** True when arranged plates no longer match the fresh plan (colors, variants or printer changed). */
	stale: boolean;
	/** Whether print logs hang on plates (re-arranging then needs a confirm). */
	hasPlateRuns: boolean;
	/** The build's print template (learned from a sliced file), when it has one: arranging uses its times and grams. */
	template?: { fileName: string | null; printer: string | null } | null;
	/** Footprints (with hulls) of the parts on arranged plates, for drawing. */
	footprints: Record<string, PrintFootprint>;
	/** True outlines of the pieces on the plates by ArrangedItem.sil key (absent for seed footprints). */
	silhouettes: Record<string, Silhouette>;
}
