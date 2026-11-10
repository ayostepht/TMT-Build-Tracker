// Browser side of the swatch catalog: cached fetches and the per-user "recently used" list.
import type { CatalogSwatches, SwatchTuple } from '#lib/domain/palettes.ts';
import { customFamily, customToTuple, type CustomFilament } from '#lib/domain/custom-filaments.ts';
import { listCustomFilaments } from './custom-filaments.ts';

export type Family = 'petg' | 'tpu';

const cache: Partial<Record<Family, Promise<SwatchTuple[]>>> = {};

/** All colors of a material family (about 11 kB gzipped for PETG, 2 kB for TPU); fetched once per page load. */
export function loadSwatches(family: Family): Promise<SwatchTuple[]> {
	// `v=2`: busts responses cached for a day before the endpoint switched to revalidation (r34).
	cache[family] ??= fetch(`/api/filaments/swatches?family=${family}&v=2`)
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

const BRAND_KEY = 'tmt.preferredBrands.v2';
/** The single-brand key of the first version; read once and migrated. */
const OLD_BRAND_KEY = 'tmt.preferredBrand.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const cleanBrands = (v: unknown): string[] => {
	if (!Array.isArray(v)) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const b of v) {
		const t = typeof b === 'string' ? b.trim() : '';
		if (t && !seen.has(t.toLowerCase())) {
			seen.add(t.toLowerCase());
			out.push(t);
		}
	}
	return out;
};

/**
 * Preferred brands from storage. A value saved by the old single-brand setting is migrated
 * transparently (written in the new format, old key dropped).
 */
export function readPreferredBrands(storage: StorageLike): string[] {
	try {
		const raw = storage.getItem(BRAND_KEY);
		if (raw !== null) return cleanBrands(JSON.parse(raw));
		const old = (storage.getItem(OLD_BRAND_KEY) ?? '').trim();
		if (!old) return [];
		const list = [old];
		try {
			storage.setItem(BRAND_KEY, JSON.stringify(list));
			storage.removeItem(OLD_BRAND_KEY);
		} catch {
			/* read-only storage: the migrated value is still returned */
		}
		return list;
	} catch {
		return [];
	}
}

export function writePreferredBrands(storage: StorageLike, brands: string[]) {
	try {
		storage.setItem(BRAND_KEY, JSON.stringify(cleanBrands(brands)));
		storage.removeItem(OLD_BRAND_KEY);
	} catch {
		/* private mode or storage blocked: the choice just doesn't persist */
	}
}

export function loadPreferredBrands(): string[] {
	try {
		return readPreferredBrands(localStorage);
	} catch {
		return [];
	}
}
export function savePreferredBrands(brands: string[]) {
	try {
		writePreferredBrands(localStorage, brands);
	} catch {
		/* ignore */
	}
}
