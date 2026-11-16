import raw from './catalog.json' with { type: 'json' };
import { materialFamily, suggestName } from '#lib/filament-catalog.ts';
import type { CatalogColor, FilamentCatalog, SlotOrigin } from './types.ts';

/** What a build slot stores: no brand reference. Material and hex may be missing on old rows. */
export interface SlotLike {
	name: string;
	material?: string | null;
	hex?: string | null;
}

interface Entry {
	brand: string;
	material: string;
	color: CatalogColor;
	density?: number;
	spoolWeightG?: number;
}

const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
const normHex = (h?: string | null) =>
	h && /^#?[0-9a-f]{6}$/i.test(h.trim()) ? h.trim().replace(/^#?/, '#').toLowerCase() : null;

interface Index {
	/** Normalised "brand color", "brand material color" and suggestName() forms -> entries. */
	byFull: Map<string, Entry[]>;
}

function buildIndex(cat: FilamentCatalog): Index {
	const byFull = new Map<string, Entry[]>();
	const add = (key: string, e: Entry) => {
		const list = byFull.get(key);
		if (!list) byFull.set(key, [e]);
		else if (!list.includes(e)) list.push(e);
	};
	for (const b of cat.brands)
		for (const m of b.materials)
			for (const c of m.colors) {
				const e: Entry = {
					brand: b.name,
					material: m.material,
					color: c,
					density: c.density ?? m.density,
					spoolWeightG: c.spoolWeightG ?? m.spoolWeightG
				};
				add(norm(suggestName(b.name, c.name)), e);
				add(norm(`${b.name} ${c.name}`), e);
				add(norm(`${b.name} ${m.material} ${c.name}`), e);
			}
	return { byFull };
}

const indexes = new WeakMap<FilamentCatalog, Index>();
function indexOf(cat: FilamentCatalog): Index {
	let i = indexes.get(cat);
	if (!i) indexes.set(cat, (i = buildIndex(cat)));
	return i;
}

/**
 * Best-effort match of a build slot to a bundled catalog color, so Spoolman suggestions can use the
 * SpoolmanDB id, density and spool weight. The slot's name must equal "Brand Color" (what the picker
 * writes, see `suggestName`), "Brand Material Color" or "Brand Color" with punctuation/case differences;
 * a bare color name never matches (too ambiguous). The slot material, when given, must be the same
 * material or at least the same family (PETG vs PCTG vs TPU). Several candidates are ranked by exact
 * material, then by hex. Returns null when nothing matches or the choice would be a guess between
 * entries that differ in id. Custom workspace filaments are never matched.
 */
export function resolveSlotOrigin(
	slot: SlotLike,
	cat: FilamentCatalog = raw as FilamentCatalog
): SlotOrigin | null {
	const name = norm(slot.name ?? '');
	if (!name) return null;
	let cands = indexOf(cat).byFull.get(name) ?? [];
	const mat = slot.material?.trim().toLowerCase();
	if (mat) {
		const fam = materialFamily(mat);
		cands = cands.filter(
			(e) =>
				e.material.toLowerCase() === mat || (fam !== 'other' && materialFamily(e.material) === fam)
		);
	}
	if (!cands.length) return null;
	const hex = normHex(slot.hex);
	const score = (e: Entry) =>
		(mat && e.material.toLowerCase() === mat ? 2 : 0) +
		(hex && e.color.hex.toLowerCase() === hex ? 1 : 0);
	const ranked = [...cands].sort((a, b) => score(b) - score(a));
	const best = ranked[0];
	const tied = ranked.filter((e) => score(e) === score(best));
	// Equal scores with different ids is a guess (e.g. no material given and two materials share the name).
	if (
		tied.length > 1 &&
		new Set(tied.map((e) => e.color.sdbId ?? `${e.material}|${e.color.hex}`)).size > 1
	)
		return null;
	return {
		brand: best.brand,
		material: best.material,
		color: best.color,
		sdbId: best.color.sdbId ?? null,
		density: best.density ?? null,
		spoolWeightG: best.spoolWeightG ?? null,
		netWeightG: best.color.weightG ?? 1000,
		confidence: !hex || best.color.hex.toLowerCase() === hex ? 'exact' : 'name'
	};
}
