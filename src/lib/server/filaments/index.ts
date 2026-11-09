import raw from './catalog.json' with { type: 'json' };
import { materialFamily, suggestName } from '#lib/filament-catalog.ts';
import {
	FLAG_APPROX,
	FLAG_GLOW,
	FLAG_MATTE,
	FLAG_MULTI,
	FLAG_SILK,
	FLAG_TRANSLUCENT,
	type SwatchTuple
} from '#lib/domain/palettes.ts';
import type { CatalogBrand, CatalogColor, FilamentCatalog, SearchHit } from './types.ts';

const catalog = raw as FilamentCatalog;

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const brandOf = (name: string): CatalogBrand | undefined =>
	catalog.brands.find((b) => eq(b.name, name));

export function meta() {
	return { source: catalog.source, license: catalog.license, fetchedAt: catalog.fetchedAt };
}

/** Brands with their material names (no colors). */
export function brands(): { name: string; materials: string[] }[] {
	return catalog.brands.map((b) => ({
		name: b.name,
		materials: b.materials.map((m) => m.material)
	}));
}

export function materials(brand: string): string[] {
	return brandOf(brand)?.materials.map((m) => m.material) ?? [];
}

export function colors(brand: string, material: string): CatalogColor[] {
	return brandOf(brand)?.materials.find((m) => eq(m.material, material))?.colors ?? [];
}

type Entry = { hay: string; hit: SearchHit };
let index: Entry[] | null = null;
function buildIndex(): Entry[] {
	const out: Entry[] = [];
	for (const b of catalog.brands)
		for (const m of b.materials)
			for (const c of m.colors)
				out.push({
					hay: `${b.name} ${m.material} ${c.name}`.toLowerCase(),
					hit: { brand: b.name, material: m.material, color: c, name: suggestName(b.name, c.name) }
				});
	return out;
}

/** Every whitespace-separated word must appear in "brand material color". */
export function search(q: string, limit = 50): SearchHit[] {
	const words = q.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	index ??= buildIndex();
	const hits: SearchHit[] = [];
	for (const e of index) {
		if (words.every((w) => e.hay.includes(w))) {
			hits.push(e.hit);
			if (hits.length >= limit) break;
		}
	}
	return hits;
}

export type SwatchFamily = 'petg' | 'tpu' | 'other';
const swatchCache = new Map<SwatchFamily, SwatchTuple[]>();

/** Space-separated flags from the catalog's structured fields ('' when none); see `FLAG_*` in palettes.ts. */
export function flagsOf(c: CatalogColor): string {
	const f: string[] = [];
	if (c.finish === 'matte') f.push(FLAG_MATTE);
	if (c.finish === 'silk') f.push(FLAG_SILK);
	if (c.translucent) f.push(FLAG_TRANSLUCENT);
	if (c.glow) f.push(FLAG_GLOW);
	if (c.hexSource === 'image') f.push(FLAG_APPROX);
	if (c.hexes && c.hexes.length > 1) f.push(FLAG_MULTI);
	return f.join(' ');
}

/**
 * Compact `[brand, color, #hex, material, flags?]` tuples for every color of a material family in a
 * catalog (swatch grids). The 5th element is only present when the catalog marks the color matte, silk,
 * translucent, glow or multi-color, which keeps the payload small.
 */
export function swatchesOf(cat: FilamentCatalog, family: SwatchFamily): SwatchTuple[] {
	const out: SwatchTuple[] = [];
	const seen = new Set<string>();
	for (const b of cat.brands)
		for (const m of b.materials) {
			if (materialFamily(m.material) !== family) continue;
			for (const c of m.colors) {
				if (!/^#[0-9a-fA-F]{6}$/.test(c.hex)) continue;
				const key = `${b.name}|${c.name}|${c.hex}|${m.material}`.toLowerCase();
				if (seen.has(key)) continue;
				seen.add(key);
				const t: SwatchTuple = [b.name, c.name, c.hex.toLowerCase(), m.material];
				const flags = flagsOf(c);
				if (flags) t.push(flags);
				out.push(t);
			}
		}
	return out;
}

/** {@link swatchesOf} for the bundled catalog, cached per family. */
export function swatches(family: SwatchFamily): SwatchTuple[] {
	let out = swatchCache.get(family);
	if (!out) swatchCache.set(family, (out = swatchesOf(catalog, family)));
	return out;
}
