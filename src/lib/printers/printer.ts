/**
 * Helpers for `BuildPrinter` (the printer a build is planned for): defaults,
 * building one from the catalog and validating user input. Browser-safe.
 */
import type { BuildPrinter } from '#lib/domain/types.ts';
import { catalogPrinter, PRINTER_CATALOG, type CatalogPrinter } from './catalog.ts';

export const DEFAULT_MARGIN = 1;
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

/** Standard bed sizes (XY, mm) offered as one-tap presets, with a typical height. */
export const BED_PRESETS: { x: number; y: number; z: number }[] = [
	{ x: 180, y: 180, z: 180 },
	{ x: 220, y: 220, z: 250 },
	{ x: 235, y: 235, z: 250 },
	{ x: 250, y: 210, z: 220 },
	{ x: 256, y: 256, z: 256 },
	{ x: 300, y: 300, z: 300 },
	{ x: 350, y: 350, z: 350 },
	{ x: 360, y: 360, z: 360 }
];
/** The most common class (Bambu X1/P1/A1, Centauri Carbon, K1 family): preselected in the New build form. */
export const DEFAULT_BED_PRESET = BED_PRESETS[4];

export const bedLabel = (x: number, y: number) => `${x} × ${y}`;

/** Short family name for grouping, e.g. Bambu "X1 Carbon" -> "X1". */
const bambuFamily = (model: string) => model.match(/^[A-Z]\d/)?.[0] ?? model;

/** Best-known Bambu families first (X1/P1/A1), others after. */
const rank = (f: string) => {
	const i = ['X1', 'P1', 'A1'].indexOf(f);
	return i < 0 ? 9 : i;
};

/**
 * A few example printers with this bed, computed from the catalog,
 * e.g. "Centauri Carbon, Bambu X1/P1/A1, SK1". Empty when the catalog has none.
 */
export function bedExamples(x: number, y: number, max = 3): string {
	const names: string[] = [];
	const bambu: string[] = [];
	let bambuAt = -1;
	for (const p of PRINTER_CATALOG) {
		if (p.bedX !== x || p.bedY !== y) continue;
		if (p.brand === 'Bambu Lab') {
			if (bambuAt < 0) bambuAt = names.push('') - 1;
			const f = bambuFamily(p.model);
			if (!bambu.includes(f)) bambu.push(f);
		} else if (!names.includes(p.model)) names.push(p.model);
	}
	if (bambuAt >= 0)
		names[bambuAt] = `Bambu ${[...bambu]
			.sort((a, b) => rank(a) - rank(b))
			.slice(0, 3)
			.join('/')}`;
	return names.slice(0, max).join(', ');
}

/** A `BuildPrinter` for a bed without a specific printer ("256 × 256 bed"). */
export function printerFromBed(
	x: number,
	y: number,
	z: number,
	mmSlots = 1,
	base?: Pick<BuildPrinter, 'nozzle' | 'margin' | 'spacing'>
): BuildPrinter {
	return {
		catalogId: null,
		name: `${bedLabel(x, y)} bed`,
		bedX: x,
		bedY: y,
		bedZ: z,
		mmSlots,
		nozzle: base?.nozzle ?? 0.4,
		margin: base?.margin ?? DEFAULT_MARGIN,
		spacing: base?.spacing ?? DEFAULT_SPACING
	};
}
