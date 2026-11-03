export interface CatalogColor {
	name: string;
	hex: string;
	hexes?: string[];
	finish?: string;
	translucent?: boolean;
	glow?: boolean;
	weightG?: number;
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
