import type { FilamentRole } from './types.ts';

/**
 * Display label for a filament: its name, plus the material only when the name
 * does not already mention it. "Primary PETG" stays as is; "Overture Blue" becomes
 * "PETG Overture Blue". A name that carries the material's base word counts as
 * mentioning it ("Accent TPU" for "TPU 95A"). Case-insensitive.
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

/**
 * Fixed display names of the kit's four filament roles, used for slot headings everywhere in the
 * design studio and the palettes. Display only: stored role names are untouched, so older builds
 * that copied other names at creation still show these.
 */
export const ROLE_LABEL: Record<string, string> = {
	primary: 'Primary PETG',
	accent: 'Accent PETG',
	soft: 'Primary TPU',
	tire: 'Accent TPU'
};

/** Slot heading: the fixed role label for the kit roles, else the filament's own label (added slots). */
export function roleLabel(key: string, f?: Pick<FilamentRole, 'name' | 'material'> | null): string {
	return ROLE_LABEL[key] ?? filamentLabel(f, key);
}

const KIT_ORDER = ['primary', 'accent', 'soft', 'tire'];

/** Display order: kit roles Primary PETG, Accent PETG, Primary TPU, Accent TPU, then added slots as given. */
export function sortRoles<T>(items: readonly T[], keyOf: (t: T) => string): T[] {
	const rank = (t: T) => {
		const i = KIT_ORDER.indexOf(keyOf(t));
		return i < 0 ? KIT_ORDER.length : i;
	};
	return items
		.map((t, i) => [t, i] as const)
		.sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
		.map(([t]) => t);
}
