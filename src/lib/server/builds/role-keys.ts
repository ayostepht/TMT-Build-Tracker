import { and, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { buildPartProfiles, buildPlates, buildUploads } from '../db/schema';

/** Moves grams keyed `from` onto `to`, adding to what `to` already has. Returns null when nothing changes. */
function moveGrams(g: Record<string, number> | null | undefined, from: string, to: string) {
	if (!g || typeof g !== 'object' || !(from in g)) return null;
	const out: Record<string, number> = { ...g };
	const moved = Number(out[from]);
	delete out[from];
	if (Number.isFinite(moved)) out[to] = (Number(out[to]) || 0) + moved;
	return out;
}

/**
 * Re-keys a build's role-keyed data from filament slot `from` to slot `to`, so removing a color keeps its
 * grams: `build_plates.filament_grams`, `build_part_profiles.grams_by_role` (summed into `to`'s grams) and the
 * `filamentMap` values of `build_uploads.summary` (3MF filament index → role key). Runs on the caller's
 * transaction handle; touches only rows of this build and only rows that mention `from`.
 */
export function remapRoleKey(tx: Db, buildId: string, from: string, to: string): void {
	if (from === to) return;
	for (const r of tx.select().from(buildPlates).where(eq(buildPlates.buildId, buildId)).all()) {
		const next = moveGrams(r.filamentGrams, from, to);
		if (next)
			tx.update(buildPlates)
				.set({ filamentGrams: next })
				.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.number, r.number)))
				.run();
	}
	for (const r of tx
		.select()
		.from(buildPartProfiles)
		.where(eq(buildPartProfiles.buildId, buildId))
		.all()) {
		const next = moveGrams(r.gramsByRole, from, to);
		if (next)
			tx.update(buildPartProfiles)
				.set({ gramsByRole: next })
				.where(
					and(eq(buildPartProfiles.buildId, buildId), eq(buildPartProfiles.partSlug, r.partSlug))
				)
				.run();
	}
	for (const u of tx.select().from(buildUploads).where(eq(buildUploads.buildId, buildId)).all()) {
		const fm = (u.summary as Record<string, unknown> | null)?.filamentMap;
		if (!fm || typeof fm !== 'object' || Array.isArray(fm)) continue;
		let changed = false;
		const next: Record<string, unknown> = {};
		for (const [idx, role] of Object.entries(fm as Record<string, unknown>)) {
			if (role === from) {
				next[idx] = to;
				changed = true;
			} else next[idx] = role;
		}
		if (changed)
			tx.update(buildUploads)
				.set({ summary: { ...u.summary, filamentMap: next } })
				.where(eq(buildUploads.id, u.id))
				.run();
	}
}
