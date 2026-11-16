/**
 * Color design logic (pure): which filament slot (role) each part uses, which
 * slots a part may use, symmetry ("apply to both sides") and the data the 3D
 * view needs. The server validates with the same functions, so the UI and the
 * API can never disagree about what is allowed.
 */
import { materialFamily } from '../filament-catalog.ts';
import type { BuildView, FilamentRole, PartDef } from './types.ts';

/** Does a filament material fit a part's allowed materials? No restriction when the part lists none. */
export function materialAllowed(allowed: string[], material: string): boolean {
	if (!allowed.length) return true;
	const fam = materialFamily(material);
	const m = material.trim().toLowerCase();
	return allowed.some((a) => {
		const af = materialFamily(a);
		return af === 'other' || fam === 'other' ? a.trim().toLowerCase() === m : af === fam;
	});
}

/** Why a part cannot use this slot, or null when it can. */
export function roleBlockedReason(part: PartDef, filament: FilamentRole): string | null {
	if (materialAllowed(part.allowedMaterials, filament.material)) return null;
	return `${part.name} needs ${part.allowedMaterials.join(' or ')}`;
}

export interface RoleOption {
	filament: FilamentRole;
	ok: boolean;
	reason: string | null;
}

/** Every slot with whether the part may use it. */
export function roleOptions(part: PartDef, filaments: FilamentRole[]): RoleOption[] {
	return filaments.map((filament) => {
		const reason = roleBlockedReason(part, filament);
		return { filament, ok: reason === null, reason };
	});
}

/** slug → hex for every part whose slot exists (all template parts, so inactive variant parts can still be shown). */
export function designColors(
	view: Pick<BuildView, 'allParts' | 'filaments'>,
	overrides: Record<string, string> = {}
): Record<string, string> {
	const hex = new Map(view.filaments.map((f) => [f.key, f.hex]));
	const out: Record<string, string> = {};
	for (const p of view.allParts) {
		const h = hex.get(overrides[p.slug] ?? p.role);
		if (h) out[p.slug] = h;
	}
	return out;
}

/** Slugs of parts that belong to a variant option that is not chosen. */
export function hiddenSlugs(view: Pick<BuildView, 'allParts' | 'parts'>): string[] {
	const active = new Set(view.parts.map((p) => p.slug));
	return view.allParts.filter((p) => !active.has(p.slug)).map((p) => p.slug);
}

/** slug → role for every template part (what a saved design stores). */
export function effectivePartRoles(view: Pick<BuildView, 'allParts'>): Record<string, string> {
	return Object.fromEntries(view.allParts.map((p) => [p.slug, p.role]));
}

/** Parts that move together with `slug` ("apply to both sides"): the whole symmetry group, or just the part. */
export function symmetryPeers(view: Pick<BuildView, 'allParts'>, slug: string): PartDef[] {
	const part = view.allParts.find((p) => p.slug === slug);
	if (!part) return [];
	if (!part.symmetryGroup) return [part];
	return view.allParts.filter((p) => p.symmetryGroup === part.symmetryGroup);
}

export interface RoleChange {
	/** slug → new role key, only for parts that actually change. */
	changes: Record<string, string>;
	/** Parts that would have moved but cannot use the slot (material). */
	blocked: { slug: string; reason: string }[];
}

/**
 * Move a part (and with `bothSides` its symmetry peers) to a slot. Parts already
 * on that slot are left out; parts whose allowed materials exclude the slot are
 * reported in `blocked` and left alone.
 */
export function applyPartRole(
	view: Pick<BuildView, 'allParts' | 'filaments'>,
	slug: string,
	role: string,
	opts: { bothSides?: boolean } = {}
): RoleChange {
	const f = view.filaments.find((x) => x.key === role);
	const targets = opts.bothSides
		? symmetryPeers(view, slug)
		: view.allParts.filter((p) => p.slug === slug);
	const out: RoleChange = { changes: {}, blocked: [] };
	if (!f) return out;
	for (const p of targets) {
		const reason = roleBlockedReason(p, f);
		if (reason) out.blocked.push({ slug: p.slug, reason });
		else if (p.role !== role) out.changes[p.slug] = role;
	}
	return out;
}

/** A readable, unique role key for a new color ("Polymaker Red" → "polymaker-red", then "-2", …). */
export function newRoleKey(existing: Iterable<string>, name: string): string {
	const taken = new Set(existing);
	const base =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 24) || 'color';
	let key = base;
	for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
	return key;
}

export const ROLE_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** Parts per slot: role key → parts (all template parts when `all`, else active ones). */
export function partsByRole(
	view: Pick<BuildView, 'parts' | 'allParts'>,
	opts: { all?: boolean } = {}
): Map<string, PartDef[]> {
	const m = new Map<string, PartDef[]>();
	for (const p of opts.all ? view.allParts : view.parts) {
		const l = m.get(p.role);
		if (l) l.push(p);
		else m.set(p.role, [p]);
	}
	return m;
}

// ---- Palette reset, "Lock part color" and removing an in-use color

/**
 * What applying a palette does to part-level color changes: every unlocked part that is not on its
 * kit slot goes back there (`reset`); locked parts keep their color (`kept`, all locked parts).
 */
export function paletteReset(view: Pick<BuildView, 'allParts'>): {
	reset: PartDef[];
	kept: PartDef[];
} {
	const reset: PartDef[] = [];
	const kept: PartDef[] = [];
	for (const p of view.allParts) {
		if (p.locked) kept.push(p);
		else if (p.role !== p.defaultRole) reset.push(p);
	}
	return { reset, kept };
}

export interface RemoveImpactPart {
	part: PartDef;
	/** The part belongs to a variant option that is not chosen: not in the 3D view or totals, but it moves too. */
	inactive: boolean;
}

/** Every part on a slot (chosen options first), whether or not its variant is active: all of them move when it is removed. */
export function removeImpact(
	view: Pick<BuildView, 'allParts' | 'parts'>,
	key: string
): RemoveImpactPart[] {
	const active = new Set(view.parts.map((p) => p.slug));
	return view.allParts
		.filter((p) => p.role === key)
		.map((part) => ({ part, inactive: !active.has(part.slug) }))
		.sort((a, b) => Number(a.inactive) - Number(b.inactive));
}

export interface ReplacementOption {
	filament: FilamentRole;
	ok: boolean;
	/** Set when `ok` is false: the first affected part that cannot use this slot, and why. */
	reason: string | null;
}

/** The other slots a removed slot's parts could move to; a slot is blocked when any of those parts cannot use its material. */
export function replacementOptions(
	view: Pick<BuildView, 'allParts' | 'filaments'>,
	key: string
): ReplacementOption[] {
	const affected = view.allParts.filter((p) => p.role === key);
	return view.filaments
		.filter((f) => f.key !== key)
		.map((filament) => {
			for (const p of affected) {
				const reason = roleBlockedReason(p, filament);
				if (reason) return { filament, ok: false, reason };
			}
			return { filament, ok: true, reason: null };
		});
}

/** Do two filaments look the same (name, material, color)? Used to reuse a slot that already holds a locked part's color. */
export function sameFilament(
	a: { name: string; material: string; hex: string },
	b: { name: string; material: string; hex: string }
): boolean {
	return (
		a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
		a.material.trim().toLowerCase() === b.material.trim().toLowerCase() &&
		a.hex.toLowerCase() === b.hex.toLowerCase()
	);
}
