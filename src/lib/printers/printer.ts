/**
 * Helpers for `BuildPrinter` (the printer a build is planned for): defaults,
 * building one from the catalog and validating user input. Browser-safe.
 */
import type { BuildPrinter } from '#lib/domain/types.ts';
import { catalogPrinter, type CatalogPrinter } from './catalog.ts';

export const DEFAULT_MARGIN = 5;
export const DEFAULT_SPACING = 8;

export const BED_LIMITS = { min: 50, max: 1000 } as const;

/** A BuildPrinter from a catalog entry; `mmIndex` picks one of its multi-material systems (null = none). */
export function printerFromCatalog(
	c: CatalogPrinter,
	mmIndex: number | null = c.mmBuiltIn ? 0 : null
): BuildPrinter {
	const mm = mmIndex != null ? c.mm[mmIndex] : undefined;
	return {
		catalogId: c.id,
		name: `${c.brand} ${c.model}`,
		bedX: c.bedX,
		bedY: c.bedY,
		bedZ: c.bedZ,
		mmSlots: mm?.slots ?? 1,
		nozzle: c.nozzle,
		margin: DEFAULT_MARGIN,
		spacing: DEFAULT_SPACING
	};
}

const num = (v: unknown, lo: number, hi: number, field: string): number => {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi)
		throw new Error(`${field} must be a number from ${lo} to ${hi}`);
	return Math.round(v * 100) / 100;
};

/** Validate untrusted input; throws an Error with a user-readable message. */
export function parsePrinter(v: unknown): BuildPrinter {
	if (typeof v !== 'object' || v === null || Array.isArray(v))
		throw new Error('printer must be an object');
	const o = v as Record<string, unknown>;
	let catalogId: string | null = null;
	if (o.catalogId !== undefined && o.catalogId !== null && o.catalogId !== '') {
		if (typeof o.catalogId !== 'string' || !catalogPrinter(o.catalogId))
			throw new Error('Unknown printer in the catalog');
		catalogId = o.catalogId;
	}
	const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
	if (!name) throw new Error('Give the printer a name');
	const slots = num(o.mmSlots ?? 1, 1, 16, 'Filament slots');
	if (!Number.isInteger(slots)) throw new Error('Filament slots must be a whole number');
	return {
		catalogId,
		name,
		bedX: num(o.bedX, BED_LIMITS.min, BED_LIMITS.max, 'Bed X'),
		bedY: num(o.bedY, BED_LIMITS.min, BED_LIMITS.max, 'Bed Y'),
		bedZ: num(o.bedZ ?? 250, BED_LIMITS.min, 2000, 'Bed Z'),
		mmSlots: slots,
		nozzle: num(o.nozzle ?? 0.4, 0.1, 2, 'Nozzle'),
		margin: num(o.margin ?? DEFAULT_MARGIN, 0, 50, 'Margin'),
		spacing: num(o.spacing ?? DEFAULT_SPACING, 0, 50, 'Spacing')
	};
}
