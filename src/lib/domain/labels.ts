import type { FilamentRole } from './types.ts';

/**
 * Display label for a filament: its name, plus the material only when the name
 * does not already mention it. "Primary PETG" stays as is; "Overture Blue" becomes
 * "PETG Overture Blue". A name that carries the material's base word counts as
 * mentioning it ("Tire TPU" for "TPU 95A"). Case-insensitive.
 */
export function filamentLabel(
	f: Pick<FilamentRole, 'name' | 'material'> | undefined | null,
	fallback = ''
): string {
	if (!f) return fallback;
	const name = f.name.trim();
	const material = f.material.trim();
	if (!material) return name || fallback;
	if (!name) return material;
	const hay = name.toLowerCase();
	const base = material.toLowerCase().split(/\s+/)[0];
	const words = hay.split(/[^a-z0-9+]+/);
	return hay.includes(material.toLowerCase()) || words.includes(base)
		? name
		: `${material} ${name}`;
}
