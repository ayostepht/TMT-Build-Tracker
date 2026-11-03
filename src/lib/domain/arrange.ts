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
 * `spacing` between neighbours (rectangle packing; hulls are for drawing).
 *
 * Algorithm: parts sharing a filament role (and run count) form one pool, sorted by
 * area, descending. Each keep-together block (a part, or parts with the same `group`) goes
 * on the fullest plate it fits (MaxRects, best short side fit, 0/90 rotation), else
 * a new plate; a block too large for one bed is split item by item. Afterwards
 * underfilled plates are merged whenever the printer's multi-material slots allow
 * and the materials are compatible (PETG never shares a plate with TPU).
 */
import { boxOrients, rotatePoints, type Pt } from './geom2d.ts';
import { chooseOrientation, describePose, type OrientData, type PrintPose } from './orient.ts';
import type { PrintFootprint } from './print-footprint.ts';
import type { BuildPrinter } from './types.ts';

const EPS = 1e-6;

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
	/** Build volume height; parts taller than this (minus a small margin) are not re-oriented onto their end. Unknown = no limit. */
	bedZ?: number;
	/** Keep-out border around the bed edge. */
	margin: number;
	/** Gap between parts. */
	spacing: number;
	/** Filaments one plate may use. */
	mmSlots: number;
}

export interface ArrangeOptions {
	/** Merge phase only touches plates below this utilisation (0..1). Default 0.6. */
	mergeBelow?: number;
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

/** The 3D pose of a re-oriented item: stored vertex p -> m*p + t, then rotation about z and move to (x, y). */
export type ItemPose = Pick<
	PrintPose,
	'kind' | 'm' | 't' | 'h' | 'hull' | 'contactArea' | 'supportScore'
> & {
	/** "stands on its edge, 248 mm tall" */
	desc: string;
};

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
	/** Degrees counter-clockwise about z, applied to the mesh before moving it to (x, y). 0 or 90 normally; any angle when the part only fits the bed tilted (hull-based). */
	rotation: number;
	role: string;
	/** Where the turned mesh's box centre lies relative to its origin; the mesh is moved to (x - ox, y - oy). Absent for 0/90 degrees. */
	ox?: number;
	oy?: number;
	/** Set when the part is re-oriented in 3D (it did not fit in its profile orientation). */
	pose?: ItemPose;
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
	bed: { x: number; y: number; margin: number };
}

export type ArrangeWarningCode =
	'oversize' | 'split' | 'unsized' | 'unknown-role' | 'tilted' | 'reoriented';
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

/** A placement candidate: box after turning by `rot` degrees; `pose` when the part is re-oriented in 3D. */
interface Orient {
	w: number;
	d: number;
	rot: number;
	/** Centre of the turned outline relative to the mesh origin (free angles only). */
	ox?: number;
	oy?: number;
	pose?: ItemPose;
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
	pose?: ItemPose;
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
		pose?: ItemPose;
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

/** Headroom kept below the build volume when a part is stood up. */
const HEIGHT_MARGIN = 2;

/**
 * Placement candidates for one piece: its profile orientation (0/90 degrees, or tilted in
 * the plane when only that fits); when none fits and the piece carries orientation data
 * (imported geometry), the best fitting resting pose instead. Exported for tests.
 */
export function pieceOrients(
	pc: { w: number; d: number; h?: number; hull?: Pt[]; orient?: OrientData },
	rotate: boolean,
	usableX: number,
	usableY: number,
	maxH = Infinity
): Orient[] {
	const base: Orient[] = boxOrients(pc, rotate, usableX, usableY);
	const fits = (o: { w: number; d: number }) => o.w <= usableX + EPS && o.d <= usableY + EPS;
	if (!rotate || !pc.orient?.poses.length || base.some(fits)) return base;
	const ch = chooseOrientation(
		{ w: pc.w, d: pc.d, h: pc.h ?? 0, hull: pc.hull },
		pc.orient.poses,
		{ usableX, usableY, maxH },
		true
	);
	if (!ch.pose) return base;
	const pose = ch.pose;
	const info: ItemPose = {
		kind: pose.kind,
		m: pose.m,
		t: pose.t,
		h: pose.h,
		hull: pose.hull,
		contactArea: pose.contactArea,
		supportScore: pose.supportScore,
		desc: describePose(pose, pc.h ?? 0)
	};
	return boxOrients(pose, true, usableX, usableY)
		.filter(fits)
		.map((o) => ({ ...o, pose: info }));
}

/** Arrange parts onto plates for a printer. */
export function arrange(input: ArrangeInput): ArrangeResult {
	const { printer } = input;
	const warnings: ArrangeWarning[] = [];
	const spacing = Math.max(0, printer.spacing);
	const margin = Math.max(0, printer.margin);
	const usableX = Math.max(0, printer.bedX - 2 * margin);
	const usableY = Math.max(0, printer.bedY - 2 * margin);
	const binW = usableX + spacing;
	const binH = usableY + spacing;
	const maxH = printer.bedZ ? printer.bedZ - HEIGHT_MARGIN : Infinity;
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
					orients: pieceOrients(pc, p.rotate !== false, usableX, usableY, maxH),
					role: p.role,
					order: partIndex.get(p.slug)!
				});
		});
		itemsOf.set(p.slug, list);
	}

	const fitsEmpty = (it: Item): boolean =>
		it.orients.some((o) => o.w <= usableX + 1e-6 && o.d <= usableY + 1e-6);

	// 2. oversize parts get their own plate
	const plates: PlateState[] = [];
	const oversizePlates: { part: ArrangePart; items: Item[] }[] = [];
	const normal: ArrangePart[] = [];
	for (const p of parts) {
		const items = itemsOf.get(p.slug)!;
		const bad = items.find((i) => !fitsEmpty(i));
		if (bad || !items.length) {
			if (bad) {
				const big = items.reduce((a, b) => (area(b) > area(a) ? b : a));
				const pc = p.footprint.pieces[bad.piece];
				const tried = pc?.orient?.poses.length ?? 0;
				const advice =
					p.rotate === false
						? ''
						: tried
							? ` Standing or tilting it (${tried + 1} orientations tried) does not fit either.`
							: ' Importing the print geometry in the kit admin page lets the arranger try standing or tilting it.';
				warnings.push({
					code: 'oversize',
					slug: p.slug,
					message:
						`${p.name} ${Math.round(Math.max(big.w, big.d))}×${Math.round(Math.min(big.w, big.d))} mm doesn't fit a ` +
						`${printer.bedX}×${printer.bedY} mm bed${p.rotate === false ? '' : ' even rotated'}.` +
						advice +
						(p.hint ? ` ${p.hint}` : '')
				});
				oversizePlates.push({ part: p, items });
			}
			continue;
		}
		normal.push(p);
	}

	const newPlate = (runs: number): PlateState => ({
		bin: new MaxRects(binW, binH),
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
				oy: o.oy,
				pose: o.pose
			});
			next.roles.add(it.role);
		}
		return next;
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
	const bedInfo = { x: printer.bedX, y: printer.bedY, margin };
	const toPlate = (
		pl: PlateState | null,
		fallback?: { part: ArrangePart; items: Item[] }
	): ArrangedPlate => {
		const rawItems = pl
			? pl.items
			: fallback!.items.map((i) => ({ ...i, x: 0, y: 0, pw: i.w, pd: i.d, rot: 0 }));
		const runs = pl ? pl.runs : runsOf(fallback!.part);
		const items: ArrangedItem[] = rawItems
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
				...(i.ox || i.oy ? { ox: i.ox, oy: i.oy } : {}),
				...(i.pose ? { pose: i.pose } : {})
			}));
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
	for (const [slug, nums] of where)
		if (nums.length > 1)
			warnings.push({
				code: 'split',
				slug,
				message: `${partOf.get(slug)?.name ?? slug} is split over plates ${nums.length > 2 ? `${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}` : nums.join(' and ')} because its copies do not fit one plate.`
			});
	const tilted = new Map<string, number>();
	for (const p of result)
		for (const i of p.items)
			if (i.rotation % 90 !== 0 && !tilted.has(i.slug)) tilted.set(i.slug, i.rotation);
	for (const [slug, deg] of tilted)
		warnings.push({
			code: 'tilted',
			slug,
			message: `${partOf.get(slug)?.name ?? slug} only fits when turned ${Math.round(deg)}° on the bed.`
		});
	const turned = new Map<string, string>();
	for (const p of result)
		for (const i of p.items) if (i.pose && !turned.has(i.slug)) turned.set(i.slug, i.pose.desc);
	for (const [slug, desc] of turned)
		warnings.push({
			code: 'reoriented',
			slug,
			message: `${partOf.get(slug)?.name ?? slug} re-oriented to fit ${printer.bedX}×${printer.bedY} (${desc}); check supports in your slicer.`
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
	/** Footprints (with hulls) of the parts on arranged plates, for drawing. */
	footprints: Record<string, PrintFootprint>;
}
