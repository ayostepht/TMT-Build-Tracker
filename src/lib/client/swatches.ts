// Browser side of the swatch catalog: cached fetches and the per-user "recently used" list.
import type { CatalogSwatches, SwatchTuple } from '#lib/domain/palettes.ts';
import { customFamily, customToTuple, type CustomFilament } from '#lib/domain/custom-filaments.ts';
import { listCustomFilaments } from './custom-filaments.ts';

export type Family = 'petg' | 'tpu';

const cache: Partial<Record<Family, Promise<SwatchTuple[]>>> = {};

/** All colors of a material family (about 11 kB gzipped for PETG, 2 kB for TPU); fetched once per page load. */
export function loadSwatches(family: Family): Promise<SwatchTuple[]> {
	cache[family] ??= fetch(`/api/filaments/swatches?family=${family}`)
		.then((r) =>
			r.ok ? r.json() : Promise.reject(new Error('The filament catalog is unavailable.'))
		)
		.then((j: { swatches: SwatchTuple[] }) => j.swatches)
		.catch((e) => {
			delete cache[family];
			throw e;
		});
	return cache[family]!;
}

/** Catalog colors plus the workspace's own filaments (custom ones first), for the palette matcher. */
export async function loadCatalog(organizationId?: string): Promise<CatalogSwatches> {
	const [petg, tpu, custom] = await Promise.all([
		loadSwatches('petg'),
		loadSwatches('tpu'),
		organizationId
			? listCustomFilaments(organizationId).catch(() => [] as CustomFilament[])
			: Promise.resolve([] as CustomFilament[])
	]);
	const mine = (fam: Family) => custom.filter((f) => customFamily(f) === fam).map(customToTuple);
	return { petg: [...mine('petg'), ...petg], tpu: [...mine('tpu'), ...tpu] };
}

const RECENT_KEY = 'tmt.recentFilaments.v1';
const RECENT_MAX = 14;

export function loadRecent(): SwatchTuple[] {
	try {
		const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
		return Array.isArray(v)
			? v.filter(
					(t) =>
						Array.isArray(t) &&
						(t.length === 4 || t.length === 5) &&
						t.every((s) => typeof s === 'string')
				)
			: [];
	} catch {
		return [];
	}
}

/** Remember a pick (most recent first, no duplicates). Returns the new list. */
export function rememberRecent(t: SwatchTuple): SwatchTuple[] {
	const list = [t, ...loadRecent().filter((r) => r[0] !== t[0] || r[1] !== t[1] || r[3] !== t[3])];
	const next = list.slice(0, RECENT_MAX);
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify(next));
	} catch {
		/* private mode or storage blocked: the list just doesn't persist */
	}
	return next;
}

export { POPULAR_BRANDS } from '#lib/domain/palettes.ts';

const BRAND_KEY = 'tmt.preferredBrand.v1';
export function loadPreferredBrand(): string {
	try {
		return localStorage.getItem(BRAND_KEY) ?? '';
	} catch {
		return '';
	}
}
export function savePreferredBrand(b: string) {
	try {
		localStorage.setItem(BRAND_KEY, b);
	} catch {
		/* ignore */
	}
}
