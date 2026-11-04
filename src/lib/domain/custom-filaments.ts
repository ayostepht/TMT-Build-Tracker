/**
 * A workspace's own filaments (pure): shapes, validation limits, common materials per family and
 * the conversion into catalog swatch tuples so palettes and pickers treat them like catalog entries.
 */
import { materialFamily, type MaterialFamily } from '../filament-catalog.ts';
import {
	FLAG_MATTE,
	FLAG_SILK,
	FLAG_SPARKLE,
	FLAG_TRANSLUCENT,
	type SwatchTuple
} from './palettes.ts';

export interface CustomFilament {
	id: string;
	organizationId: string;
	brand: string;
	material: string;
	colorName: string;
	hex: string;
	finish: string | null;
	hardness: string | null;
	url: string | null;
	notes: string;
	createdAt: number;
	updatedAt: number | null;
}

/** Fields a client may send when creating or editing one. */
export interface CustomFilamentInput {
	brand: string;
	material: string;
	colorName: string;
	hex: string;
	finish?: string | null;
	hardness?: string | null;
	url?: string | null;
	notes?: string;
}

export const FINISHES = ['matte', 'silk', 'glossy', 'translucent', 'sparkle'] as const;
export type Finish = (typeof FINISHES)[number];

export const CUSTOM_LIMITS = {
	brand: 60,
	material: 40,
	colorName: 60,
	finish: 20,
	hardness: 12,
	url: 300,
	notes: 500
} as const;

/** Common materials per slot family; the form's "Type" select, plus a free-text "Other…". */
export const COMMON_MATERIALS: Record<'petg' | 'tpu', string[]> = {
	petg: ['PETG', 'PETG HF', 'PETG-CF', 'PETG Pro', 'PLA', 'PLA+', 'ABS', 'ASA'],
	tpu: ['TPU 95A', 'TPU 90A', 'TPU 85A', 'TPU 75A', 'TPU 64D']
};

const FLAG_FOR_FINISH: Partial<Record<Finish, string>> = {
	matte: FLAG_MATTE,
	silk: FLAG_SILK,
	translucent: FLAG_TRANSLUCENT,
	sparkle: FLAG_SPARKLE
};

/** Material as shown and matched: a TPU's hardness is appended when the material doesn't state it. */
export function customMaterialLabel(f: Pick<CustomFilament, 'material' | 'hardness'>): string {
	const m = f.material.trim();
	const h = (f.hardness ?? '').trim();
	if (h && materialFamily(m) === 'tpu' && !m.toUpperCase().includes(h.toUpperCase()))
		return `${m} ${h}`;
	return m;
}

/** The slot family a custom filament fits: PETG HF is PETG, TPU 95A is TPU, anything else is "other". */
export const customFamily = (f: Pick<CustomFilament, 'material'>): MaterialFamily =>
	materialFamily(f.material);

/** As a catalog swatch tuple, so the palette matcher applies the same exclusion rules. */
export function customToTuple(f: CustomFilament): SwatchTuple {
	const flag = f.finish ? FLAG_FOR_FINISH[f.finish as Finish] : undefined;
	const t: SwatchTuple = [f.brand, f.colorName, f.hex.toLowerCase(), customMaterialLabel(f)];
	if (flag) t.push(flag);
	return t;
}

/** Lower-case identity for the duplicate check (same brand, material and color name). */
export const customKey = (f: Pick<CustomFilamentInput, 'brand' | 'material' | 'colorName'>) =>
	[f.brand, f.material, f.colorName]
		.map((s) => s.trim().replace(/\s+/g, ' ').toLowerCase())
		.join('|');

/** Brands in use, case-insensitively unique, sorted. */
export function customBrands(list: Pick<CustomFilament, 'brand'>[]): string[] {
	const seen = new Map<string, string>();
	for (const f of list)
		if (!seen.has(f.brand.toLowerCase())) seen.set(f.brand.toLowerCase(), f.brand);
	return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
