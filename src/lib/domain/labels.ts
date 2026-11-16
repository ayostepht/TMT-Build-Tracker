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

type SlotLike = Pick<FilamentRole, 'name' | 'material'> & { key?: string; kit?: boolean };

/**
 * Slot heading: the fixed role label for the kit roles, else the filament's own label (added slots).
 * An added slot whose label equals a kit label (a locked part's old "Accent PETG") or another added
 * slot's label gets a suffix ("Accent PETG · added", "… · added 2"), so two chips never read the same.
 * Pass `all` (the build's filaments) to also tell added slots apart; the filament's own name is unchanged.
 */
export function roleLabel(
	key: string,
	f?: SlotLike | null,
	all?: readonly SlotLike[] | null
): string {
	if (ROLE_LABEL[key]) return ROLE_LABEL[key];
	const base = filamentLabel(f, key);
	if (!f || f.kit !== false) return base;
	const norm = base.trim().toLowerCase();
	const collidesKit = Object.values(ROLE_LABEL).some((l) => l.toLowerCase() === norm);
	const twins = (all ?? []).filter(
		(o) =>
			o.kit === false &&
			filamentLabel(o, o.key ?? '')
				.trim()
				.toLowerCase() === norm
	);
	if (!collidesKit && twins.length < 2) return base;
	const idx = Math.max(
		0,
		twins.findIndex((o) => o.key === key)
	);
	return `${base} · added${idx > 0 ? ` ${idx + 1}` : ''}`;
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
