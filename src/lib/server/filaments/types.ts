export interface CatalogColor {
	name: string;
	hex: string;
	hexes?: string[];
	finish?: string;
	translucent?: boolean;
	glow?: boolean;
	weightG?: number;
	/** Vendor supplement only: 'store' = exact hex from the store, 'image' = sampled from a product photo (estimate), 'filascope' = hex shown by filascope.com. */
	hexSource?: 'store' | 'image' | 'filascope';
}
export interface CatalogMaterial {
	material: string;
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
	color: CatalogColor;
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
