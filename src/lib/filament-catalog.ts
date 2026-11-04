// Pure helpers shared by the filament picker (browser) and the catalog (server).

/** "Overture" + "Digital Blue" -> "Overture Digital Blue"; unchanged if the color already starts with the brand. */
export function suggestName(brand: string, color: string): string {
	const b = brand.trim();
	const c = color.trim();
	if (!b) return c;
	if (c.toLowerCase().startsWith(b.toLowerCase())) return c;
	return `${b} ${c}`;
}

export type MaterialFamily = 'tpu' | 'petg' | 'other';

export function materialFamily(material: string): MaterialFamily {
	const m = material.trim().toLowerCase();
	if (/^(tpu|tpe|tpc)/.test(m) || /\b(tpu|tpe)\b/.test(m)) return 'tpu';
	if (/^(petg|pctg|htpet|pet-?g)/.test(m) || /\b(petg|pctg)\b/.test(m)) return 'petg';
	return 'other';
}

/** Stable sort: materials in the preferred family first (hint like "TPU 95A" or "PETG"). */
export function preferMaterials<T>(
	items: T[],
	hint: string | undefined,
	get: (t: T) => string
): T[] {
	const want = hint ? materialFamily(hint) : 'other';
	if (want === 'other') return items;
	const fam = items.filter((i) => materialFamily(get(i)) === want);
	return [...fam, ...items.filter((i) => materialFamily(get(i)) !== want)];
}
