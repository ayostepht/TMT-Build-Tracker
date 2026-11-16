/**
 * `spoolman_cache`: the last Spoolman filament (with its spools) the app saw, per workspace, so the
 * stock line and Spare keep working when Spoolman is down. A failed fetch only sets `error`; the
 * last good numbers stay and show as stale.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { spoolmanCache } from '../db/schema';
import {
	fromCacheData,
	SpoolmanError,
	toCacheData,
	type FilamentWithSpools,
	type SpoolmanClient
} from './client';

export function writeCache(db: Db, org: string, f: FilamentWithSpools, now = new Date()): void {
	const row = { data: toCacheData(f), fetchedAt: now, error: null };
	db.insert(spoolmanCache)
		.values({ organizationId: org, spoolmanFilamentId: f.id, ...row })
		.onConflictDoUpdate({
			target: [spoolmanCache.organizationId, spoolmanCache.spoolmanFilamentId],
			set: row
		})
		.run();
}

/** Remember that the last fetch failed; the row's data stays. No row yet: nothing to mark. */
export function markCacheError(db: Db, org: string, filamentId: number, message: string): void {
	db.update(spoolmanCache)
		.set({ error: message.slice(0, 300) })
		.where(
			and(eq(spoolmanCache.organizationId, org), eq(spoolmanCache.spoolmanFilamentId, filamentId))
		)
		.run();
}

export function readCached(db: Db, org: string, filamentId: number): FilamentWithSpools | null {
	const r = db
		.select()
		.from(spoolmanCache)
		.where(
			and(eq(spoolmanCache.organizationId, org), eq(spoolmanCache.spoolmanFilamentId, filamentId))
		)
		.get();
	return r ? fromCacheData(r.data) : null;
}

export function readAllCached(db: Db, org: string): FilamentWithSpools[] {
	return db
		.select()
		.from(spoolmanCache)
		.where(eq(spoolmanCache.organizationId, org))
		.all()
		.map((r) => fromCacheData(r.data))
		.filter((x): x is FilamentWithSpools => !!x);
}

/**
 * Fetch one filament with its spools and store it. On failure the row is marked stale (when there
 * is one) and the error text returned; never throws.
 */
export async function refreshFilament(
	db: Db,
	org: string,
	client: SpoolmanClient,
	filamentId: number
): Promise<{ filament?: FilamentWithSpools; error?: string }> {
	try {
		const f = await client.getFilamentWithSpools(filamentId);
		writeCache(db, org, f);
		return { filament: f };
	} catch (e) {
		const error = e instanceof SpoolmanError ? e.message : 'Spoolman failed';
		markCacheError(db, org, filamentId, error);
		return { error };
	}
}

/** Refresh several filaments one after another; returns the first error text, if any. */
export async function refreshFilaments(
	db: Db,
	org: string,
	client: SpoolmanClient,
	ids: Iterable<number>
): Promise<string | undefined> {
	let first: string | undefined;
	for (const id of new Set(ids)) {
		const r = await refreshFilament(db, org, client, id);
		first ??= r.error;
		if (r.error) break; // Spoolman is down: do not wait for every filament to time out
	}
	return first;
}

/** Spools of a filament that can still be used, oldest id first. Unknown remaining counts as open. */
export function openSpools(f: Pick<FilamentWithSpools, 'spools'>) {
	return f.spools
		.filter((s) => !s.archived && (s.remainingG == null || s.remainingG > 0))
		.sort((a, b) => a.id - b.id);
}
