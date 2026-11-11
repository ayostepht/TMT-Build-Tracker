/**
 * What the service worker may answer. Pure so it is unit-tested; `src/service-worker.ts` is the
 * only caller. Anything not matched here goes to the network untouched.
 */
export const OFFLINE_URL = '/offline.html';

/**
 * Runtime cache for kit model GLBs: the only cache that can hold per-user content (a private kit
 * copy's model). The page deletes it on sign-out (`clearPrivateCaches` in `pwa.ts`); the shell
 * precache is never touched. Shared by the worker and the page so the names cannot drift.
 */
export const RUNTIME_CACHE = 'tmt-runtime-v1';
/** Most models kept in the runtime cache; the oldest entries are evicted first. */
export const RUNTIME_MAX_ENTRIES = 12;

/** How many of the oldest entries (cache keys are in insertion order) to drop to fit `max`. */
export function evictCount(entries: number, max = RUNTIME_MAX_ENTRIES): number {
	return Math.max(0, entries - max);
}

/**
 * Build files left out of the precache (fetched from the network on demand, HTTP-cached): the
 * pdf.js worker, 1.3 MB used only by the kit admin's guide import.
 */
export function isPrecacheExcluded(path: string): boolean {
	return (
		path === '/robots.txt' || /^\/_app\/immutable\/assets\/pdf\.worker\.min\.[^/]+\.mjs$/.test(path)
	);
}

/** Only a complete same-origin 200 is stored; opaque, redirected-error or partial responses are not. */
export function isCacheableResponse(res: { type: string; status: number }): boolean {
	return res.type === 'basic' && res.status === 200;
}

/** Paths the worker never handles, whatever else matches (data, auth, streams, downloads). */
const NEVER = /^\/(api|invite|reset-password)(\/|$)/;

/** A page load that failed offline gets the offline page; API and download paths are left alone. */
export function isOfflineFallbackRequest(mode: string, pathname: string): boolean {
	return mode === 'navigate' && !NEVER.test(pathname);
}

/**
 * `shell`: cache-first, only for exact members of the precache (hashed build output, fonts, icons, offline page).
 * `model`: runtime cache for a kit GLB, only when the URL is versioned with `?v=`.
 * `null`: not ours.
 */
export function cacheKind(
	pathname: string,
	search: string,
	precached: readonly string[]
): 'shell' | 'model' | null {
	if (/^\/api\/templates\/[A-Za-z0-9_-]+\/(model|hardware)\.glb$/.test(pathname)) {
		return /[?&]v=[^&]+/.test(search) ? 'model' : null;
	}
	if (NEVER.test(pathname)) return null;
	// Exact membership only (the precache already lists every `/_app/immutable/*` file); a prefix
	// rule would also match odd paths such as `..%2f`. Encoded or dot-dot paths are never ours.
	if (/%|\.\./.test(pathname)) return null;
	if (precached.includes(pathname)) return 'shell';
	return null;
}
