/**
 * Print footprint of a template part: how much bed one printed unit takes, in the
 * orientation the kit author prints it. Numbers only (the meshes live in the data
 * volume, see src/lib/server/print-geometry/). Pure, browser-safe.
 */
import type { FitPiece, Pt } from './geom2d.ts';
import type { PieceSilhouettes } from './silhouette.ts';

/** One distinct printed object of a part (connectors have several, a wing one). */
export interface PrintPiece {
	name: string;
	/** Extent along X / Y / Z in mm, print orientation, tilted-to-min-box already applied. */
	w: number;
	d: number;
	h: number;
	/** Copies of this piece in ONE unit of the part. */
	copies: number;
	/** Convex hull in mm around the bounding box centre (optional; drawing and tighter fit checks). */
	hull?: Pt[];
	tris?: number;
	/** File name of the piece's mesh inside `uploadsDir()/print/<templateId>/` (imported geometry only). */
	mesh?: string;
	/** The kit author's slicer settings for this object (wall_loops, sparse_infill_density, ...). */
	settings?: Record<string, string>;
	/** Per-volume slicer settings of the kit author's object (written to the part's metadata). */
	partSettings?: Record<string, string>;
	/** Painted triangles kept with the mesh (supports, seam); the export writes them back. */
	paint?: { supports: number; seam: number };
	/** True top-down outline of the piece as stored (profile orientation); computed on import or on first use. */
	sil?: PieceSilhouettes;
}

/** Version of the `groups` data; arrangers ignore groups of another version. */
export const GROUP_VERSION = 1;

/** One printed object of a source group: a piece's stored mesh placed in the group's frame. */
export interface GroupItem {
	/** Index into `PrintFootprint.pieces`. */
	piece: number;
	/** Where the stored mesh's origin sits relative to the group origin, mm. */
	x: number;
	y: number;
	/** Degrees counter-clockwise about z applied to the stored mesh: `p' = Rz(rot) * p + (x, y)` (group frame). */
	rot: number;
}

/**
 * Pieces of a part that share a plate of the kit author's profile, kept as they were laid out:
 * the arranger places the whole group as one rigid item (move and turn flat about z, never tilt).
 * The group frame has its origin at the centre of the outline's bounding box, axes as in the
 * source file, so a group placed with rotation 0 reproduces the author's orientation.
 */
export interface SourceGroup {
	v: number;
	/** Plate number in the source file (informational). */
	plate: number;
	/** Bed of the source profile in mm (from `printable_area`), when known. */
	bed?: { x: number; y: number };
	items: GroupItem[];
	/** Bounding box of the outline at rotation 0, mm. */
	w: number;
	d: number;
	/** Combined true outline: the pieces' silhouettes at their positions (outer rings counter-clockwise, holes clockwise). */
	outline: Pt[][];
	/** Convex hull of the outline around the group origin. */
	hull: Pt[];
}

/** The part of a group the fitter looks at (see `boxOrients`): its box, hull and outer rings. */
export function groupFit(g: SourceGroup): FitPiece {
	return { w: g.w, d: g.d, hull: g.hull, sil: { profile: { rings: g.outline } } };
}

/** Everything the arranger needs to know about one part's geometry. */
export interface PrintFootprint {
	slug: string;
	pieces: PrintPiece[];
	/** Units of the part printed in one plate run (rims: 1, hub caps: 2). Default: all units. */
	unitsPerPlate?: number;
	/** Pieces as laid out on the plates of the source profile; absent for seed footprints and older imports. */
	groups?: SourceGroup[];
}

/** Seed form (numbers only): a single box or several pieces. */
export interface PrintFootprintSeed {
	slug: string;
	w?: number;
	d?: number;
	h?: number;
	copies?: number;
	unitsPerPlate?: number;
	/** Convex outline around the box centre (single-box form only). */
	hull?: Pt[];
	pieces?: { name: string; w: number; d: number; h: number; copies: number }[];
}

export function seedToFootprint(s: PrintFootprintSeed): PrintFootprint {
	const pieces =
		s.pieces ??
		(s.w != null && s.d != null
			? [
					{
						name: s.slug,
						w: s.w,
						d: s.d,
						h: s.h ?? 0,
						copies: s.copies ?? 1,
						...(s.hull ? { hull: s.hull } : {})
					}
				]
			: []);
	return {
		slug: s.slug,
		pieces: pieces.map((p) => ({ ...p })),
		...(s.unitsPerPlate ? { unitsPerPlate: s.unitsPerPlate } : {})
	};
}

/**
 * Turn "N objects of this part were on one plate in the kit author's profile" into
 * the arranger's units: `qty` is the part's total quantity (null = a set, as for
 * tires or connectors), `counts` the number of instances per distinct piece seen on
 * the busiest plate.
 *
 * - qty null: the set as on the plate is one unit.
 * - one piece, at least `qty` copies on the plate: all units fit one run.
 * - one piece, fewer than `qty` (rims: 1 per run, qty 2): `c` units per run, the
 *   rest needs more runs.
 */
export function deriveUnits(
	qty: number | null,
	counts: number[]
): { unitsPerPlate: number; copies: number[] } {
	if (!counts.length) return { unitsPerPlate: 1, copies: [] };
	if (qty == null || qty <= 1)
		return { unitsPerPlate: 1, copies: counts.map((c) => Math.max(1, c)) };
	if (counts.length === 1) {
		const c = Math.max(1, counts[0]);
		if (c >= qty) return { unitsPerPlate: qty, copies: [Math.max(1, Math.round(c / qty))] };
		return { unitsPerPlate: c, copies: [1] };
	}
	if (counts.every((c) => c >= qty && c % qty === 0))
		return { unitsPerPlate: qty, copies: counts.map((c) => c / qty) };
	return { unitsPerPlate: 1, copies: counts.map((c) => Math.max(1, c)) };
}

/** Widest brim the arranger reserves room for, mm (a mistyped setting must not eat the bed). */
export const MAX_BRIM_MM = 20;

/**
 * Brim width in mm a piece is printed with: the author's object settings (`brim_type` other than
 * "no_brim" with `brim_width`), else the part's own "10 mm" text (kit seed, the plate legend's brim
 * chip), else 0. The arranger counts it as part of the piece's footprint.
 */
export function pieceBrimMm(
	piece: Pick<PrintPiece, 'settings' | 'partSettings'> | undefined,
	partBrimText?: string | null
): number {
	const clamp = (n: number) => (Number.isFinite(n) && n > 0 ? Math.min(MAX_BRIM_MM, n) : 0);
	const s = { ...(piece?.settings ?? {}), ...(piece?.partSettings ?? {}) };
	if (s.brim_type !== undefined) {
		if (/^no[_ ]?brim$/i.test(s.brim_type.trim())) return 0;
		return clamp(parseFloat(s.brim_width ?? ''));
	}
	if (s.brim_width !== undefined && clamp(parseFloat(s.brim_width)) > 0)
		return clamp(parseFloat(s.brim_width));
	const m = /(\d+(?:[.,]\d+)?)\s*mm/i.exec(partBrimText ?? '');
	return m ? clamp(parseFloat(m[1].replace(',', '.'))) : 0;
}

/**
 * True when two parts are the same printed geometry (the wheel rim halves: one object, two colors): the
 * same number of pieces with the same sizes, copies per unit and outline, and the same units per plate.
 * Names and meshes are not compared (the parts are named for what they are, not for their shape).
 */
export function sameGeometry(a: PrintFootprint, b: PrintFootprint): boolean {
	if (a.pieces.length !== b.pieces.length) return false;
	if ((a.unitsPerPlate ?? null) !== (b.unitsPerPlate ?? null)) return false;
	return a.pieces.every((pc, i) => {
		const o = b.pieces[i];
		if (
			Math.abs(pc.w - o.w) >= 0.05 ||
			Math.abs(pc.d - o.d) >= 0.05 ||
			Math.max(1, pc.copies) !== Math.max(1, o.copies)
		)
			return false;
		if (!pc.hull || !o.hull) return true;
		return (
			pc.hull.length === o.hull.length &&
			pc.hull.every(
				(p, k) => Math.abs(p[0] - o.hull![k][0]) < 0.05 && Math.abs(p[1] - o.hull![k][1]) < 0.05
			)
		);
	});
}
