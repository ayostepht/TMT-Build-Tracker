/**
 * Variant helpers (pure). A template's `VariantGroup`s list alternative parts for
 * one function; a build stores one chosen option per group. Parts of options that
 * are not chosen are inactive. Parts in no option are always active.
 */
import type { VariantGroup } from './types.ts';

/** One choice per group: the stored choice when it names a real option, else the group's default. */
export function resolveChoices(
	groups: VariantGroup[],
	choices?: Record<string, string> | null
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const g of groups) {
		const c = choices?.[g.key];
		out[g.key] = g.options.some((o) => o.key === c) ? (c as string) : g.defaultOption;
	}
	return out;
}

/** Slugs of parts whose option is not the chosen one in its group. */
export function inactiveSlugs(
	groups: VariantGroup[],
	choices?: Record<string, string> | null
): Set<string> {
	const chosen = resolveChoices(groups, choices);
	const out = new Set<string>();
	for (const g of groups)
		for (const o of g.options) if (o.key !== chosen[g.key]) for (const s of o.parts) out.add(s);
	// A slug listed in the chosen option of any group stays active.
	for (const g of groups)
		for (const o of g.options) if (o.key === chosen[g.key]) for (const s of o.parts) out.delete(s);
	return out;
}

/** part slug → the variant group/option it belongs to. */
export function variantOfPart(
	groups: VariantGroup[]
): Map<string, { group: string; option: string }> {
	const m = new Map<string, { group: string; option: string }>();
	for (const g of groups)
		for (const o of g.options) for (const s of o.parts) m.set(s, { group: g.key, option: o.key });
	return m;
}

/** Validates a choices object from a client; unknown groups/options throw the message. */
export function validateChoices(
	groups: VariantGroup[],
	choices: Record<string, unknown>
): string | null {
	for (const [k, v] of Object.entries(choices)) {
		const g = groups.find((x) => x.key === k);
		if (!g) return `Unknown variant group "${k}"`;
		if (typeof v !== 'string' || !g.options.some((o) => o.key === v))
			return `Unknown option for "${g.name}"`;
	}
	return null;
}
