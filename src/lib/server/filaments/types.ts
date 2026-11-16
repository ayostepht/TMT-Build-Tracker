export interface CatalogColor {
	name: string;
	hex: string;
	hexes?: string[];
	finish?: string;
	translucent?: boolean;
	glow?: boolean;
	weightG?: number;
	/** SpoolmanDB filament id (e.g. `overture_petg_black_1000_175_n`), absent for supplement colors. Server only. */
	sdbId?: string;
	/** g/cm3 when it differs from the material's `density`. Server only. */
	density?: number;
	/** Empty spool weight in grams when it differs from the material's `spoolWeightG`. Server only. */
	spoolWeightG?: number;
	/** Vendor supplement only: 'store' = exact hex from the store, 'image' = sampled from a product photo (estimate), 'filascope' = hex shown by filascope.com. */
	hexSource?: 'store' | 'image' | 'filascope';
}
export interface CatalogMaterial {
	material: string;
	/** Most common density of this brand's material (g/cm3); a color's own value wins. */
	density?: number;
	/** Most common empty-spool weight (g); a color's own value wins. */
	spoolWeightG?: number;
	colors: CatalogColor[];
}
export interface CatalogBrand {
	name: string;
	materials: CatalogMaterial[];
}
export interface FilamentCatalog {
	source: string;
	license: string;
	fetchedAt: string;
	brands: CatalogBrand[];
}
export interface SearchHit {
	brand: string;
	material: string;
	color: PublicCatalogColor;
	/** Suggested filament name: brand + color unless the color already starts with the brand. */
	name: string;
}

/** One vendor store's curated colors (src/lib/server/filaments/supplement.json, merged into the catalog by the update script). */
export interface SupplementBrand {
	name: string;
	/** Store the colors were read from. */
	sourceUrl: string;
	fetchedAt: string;
	materials: CatalogMaterial[];
}
export interface FilamentSupplement {
	brands: SupplementBrand[];
}

/** A catalog color as sent to browsers: the Spoolman fields stay on the server. */
export type PublicCatalogColor = Omit<CatalogColor, 'sdbId' | 'density' | 'spoolWeightG'>;

/** What a build slot (name, material, hex; no brand reference) was matched to, with Spoolman data resolved. */
export interface SlotOrigin {
	brand: string;
	material: string;
	color: CatalogColor;
	/** SpoolmanDB id; null for vendor-supplement colors. */
	sdbId: string | null;
	/** g/cm3 or null when the catalog has none. */
	density: number | null;
	/** Empty spool weight in grams or null. */
	spoolWeightG: number | null;
	/** Net filament weight in grams of the catalog spool (1000 when the catalog says nothing). */
	netWeightG: number;
	/** How sure the match is: 'exact' = brand + color (+ material) name and hex agree; 'name' = name matched, hex differs or was not given. */
	confidence: 'exact' | 'name';
}
