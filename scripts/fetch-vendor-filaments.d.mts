import type {
	SupplementBrand,
	FilamentSupplement,
	CatalogColor
} from '#lib/server/filaments/types.ts';

export const USER_AGENT: string;
export const VENDORS: Record<
	string,
	{ name: string; host: string; titleColor?: RegExp; swatchPage?: string; onlyHardness?: string }
>;
export function parseSwatchPage(html: string): { handle: string; title: string; hex: string }[];
export function swatchOverrides(
	swatches: { handle: string; title: string; hex: string }[],
	products: { handle: string; title: string }[]
): Record<string, { hex: string; hexSource: 'store' }>;
export function hexOf(v: unknown): string | null;
export function classifyProduct(
	product: unknown,
	brand?: string,
	opts?: { onlyHardness?: string }
):
	| { skip: string }
	| { material: string; finish?: string; highSpeed: boolean; label: string; skip?: undefined };
export function productColors(
	product: unknown,
	opts?: { titleColor?: RegExp }
): { name: string; hex: string | null; image?: string }[];
export function convertProducts(
	products: unknown[],
	brand: string,
	opts?: {
		hexOverrides?: Record<string, { hex: string; hexSource?: 'store' | 'image' }>;
		skipped?: { product: string; color?: string; reason: string; image?: string }[];
		titleColor?: RegExp;
		onlyHardness?: string;
	}
): { material: string; colors: CatalogColor[] }[];
export function buildSupplementBrand(
	vendorKey: string,
	products: unknown[],
	opts?: Parameters<typeof convertProducts>[2] & { fetchedAt?: string }
): SupplementBrand;
export function mergeBrands(
	existing: FilamentSupplement | null | undefined,
	brands: SupplementBrand[]
): FilamentSupplement;
export function fetchProducts(
	host: string,
	opts?: {
		delayMs?: number;
		maxRetries?: number;
		fetchFn?: (
			url: string,
			init?: unknown
		) => Promise<{
			status: number;
			ok: boolean;
			headers: { get(n: string): string | null };
			json(): Promise<unknown>;
		}>;
		wait?: (ms: number) => Promise<void>;
	}
): Promise<unknown[]>;
export function parseProductPage(html: string): { name: string; hex?: string; image?: string }[];
export function sampleImageHex(
	buffer: unknown,
	sharp: unknown,
	box?: [number, number, number, number]
): Promise<string>;
export function convertPages(
	pages: {
		cfg: { handle: string; material: string; label?: string; finish?: string };
		colors: { name: string; hex?: string; image?: string }[];
	}[],
	opts?: {
		hexOverrides?: Record<string, { hex: string; hexSource?: 'store' | 'image' | 'filascope' }>;
		skipped?: { product: string; color?: string; reason: string; image?: string }[];
	}
): { material: string; colors: CatalogColor[] }[];
