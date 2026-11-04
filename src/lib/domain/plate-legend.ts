/**
 * Legend of a plate diagram: one row per part (not per copy), numbered in the order the
 * parts first appear on the plate. Pure and browser-safe.
 */
import type { ArrangedPlate } from './arrange.ts';

export interface LegendRow {
	slug: string;
	/** 1-based badge number shown on the diagram and in the legend. */
	n: number;
	name: string;
	role: string;
	/** Printed objects of this part on the plate. */
	items: number;
	/** Distinct pieces (connectors have several). */
	pieces: number;
	/** "Tires ×8", "Harness and Straps: 3 pieces", or just the name. */
	label: string;
	/** Why it is turned onto another face ("stands on its edge, 248 mm tall"), when it is. */
	reoriented: string | null;
	/** Angle of a part that only fits the bed turned diagonally. */
	rotated: number | null;
	/** True when at least one copy is drawn as a box (no mesh outline known). */
	approx: boolean;
}

export function legendRows(
	plate: Pick<ArrangedPlate, 'items' | 'parts'>,
	nameOf: (slug: string) => string,
	hasOutline: (item: ArrangedPlate['items'][number]) => boolean = (it) => !!it.sil
): LegendRow[] {
	const order = [...new Set([...plate.parts, ...plate.items.map((i) => i.slug)])].filter((s) =>
		plate.items.some((i) => i.slug === s)
	);
	return order.map((slug, idx) => {
		const its = plate.items.filter((i) => i.slug === slug);
		const pieces = new Set(its.map((i) => i.piece)).size;
		const name = nameOf(slug);
		const label =
			its.length <= 1
				? name
				: pieces > 1
					? `${name}: ${its.length} pieces`
					: `${name} ×${its.length}`;
		const turned = its.find((i) => i.pose);
		const rot = its.find((i) => i.rotation % 90 !== 0);
		return {
			slug,
			n: idx + 1,
			name,
			role: its[0].role,
			items: its.length,
			pieces,
			label,
			reoriented: turned?.pose?.desc ?? null,
			rotated: rot ? Math.round(rot.rotation * 10) / 10 : null,
			approx: its.some((i) => !hasOutline(i))
		};
	});
}
