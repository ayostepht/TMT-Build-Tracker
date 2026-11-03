/**
 * Print footprint of a template part: how much bed one printed unit takes, in the
 * orientation the kit author prints it. Numbers only (the meshes live in the data
 * volume, see src/lib/server/print-geometry/). Pure, browser-safe.
 */
import type { Pt } from './geom2d.ts';

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
}

/** Everything the arranger needs to know about one part's geometry. */
export interface PrintFootprint {
	slug: string;
	pieces: PrintPiece[];
	/** Units of the part printed in one plate run (rims: 1, hub caps: 2). Default: all units. */
	unitsPerPlate?: number;
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
