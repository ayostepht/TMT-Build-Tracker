import raw from './catalog.json' with { type: 'json' };
import { suggestName } from '#lib/filament-catalog.ts';
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
