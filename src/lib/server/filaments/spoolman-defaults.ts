import { materialFamily } from '#lib/filament-catalog.ts';
import type { SlotOrigin } from './types.ts';

/** Values to send when creating a filament in Spoolman. */
export interface SpoolmanFilamentDefaults {
	/** g/cm3 (Spoolman requires it). */
	density: number;
	/** Diameter in mm; the app only handles 1.75. */
	diameter: 1.75;
	/** Net filament weight of a new spool in grams. */
	weight: number;
	/** Empty spool weight in grams. */
	spoolWeight: number;
	/** Where density and spool weight came from: the catalog entry, the material table, or generic fallback. */
	source: 'catalog' | 'material' | 'generic';
}

/** Typical densities in g/cm3 by material (lower-case, first match of the table below). */
const DENSITY: [RegExp, number][] = [
	[/^pctg/, 1.23],
	[/^(petg|pet-?g|htpet|pet)/, 1.27],
	[/^(tpu|tpe|tpc)/, 1.21],
	[/^pla/, 1.24],
	[/^abs/, 1.04],
	[/^asa/, 1.07],
	[/^(pa|nylon)/, 1.14],
	[/^pc/, 1.2]
];
export const GENERIC_DENSITY = 1.24;
/** Typical empty plastic spool; cardboard spools are lighter, so this errs on the heavy side. */
export const GENERIC_SPOOL_WEIGHT_G = 200;
export const GENERIC_NET_WEIGHT_G = 1000;

export function densityForMaterial(material: string): number | null {
	const m = material.trim().toLowerCase();
	for (const [re, d] of DENSITY) if (re.test(m)) return d;
	const fam = materialFamily(m);
	return fam === 'petg' ? 1.27 : fam === 'tpu' ? 1.21 : null;
}

/**
 * Density, spool weight and net weight to use when creating a Spoolman filament for a slot:
 * the catalog entry's values when `origin` (from `resolveSlotOrigin`) has them, else the typical value
 * for the material, else generic ones. Never returns a non-positive number.
 */
export function spoolmanDefaults(
	material: string,
	origin?: SlotOrigin | null
): SpoolmanFilamentDefaults {
	const fromCatalog = !!origin && (origin.density != null || origin.spoolWeightG != null);
	const byMaterial = densityForMaterial(material);
	return {
		density: origin?.density ?? byMaterial ?? GENERIC_DENSITY,
		diameter: 1.75,
		weight: origin?.netWeightG && origin.netWeightG > 0 ? origin.netWeightG : GENERIC_NET_WEIGHT_G,
		spoolWeight: origin?.spoolWeightG ?? GENERIC_SPOOL_WEIGHT_G,
		source: fromCatalog ? 'catalog' : byMaterial != null ? 'material' : 'generic'
	};
}
