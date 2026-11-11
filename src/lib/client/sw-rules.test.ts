import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cacheKind,
	evictCount,
	isOfflineFallbackRequest,
	RUNTIME_CACHE,
	RUNTIME_MAX_ENTRIES
} from './sw-rules.ts';
import { clearPrivateCaches, createUpdatePrompter, UPDATE_CHECK_MS } from './pwa.ts';

const shell = ['/fonts/ibm-plex-sans-var.woff2', '/offline.html', '/icons/icon-192.png'];

describe('service worker rules', () => {
	it('caches the shell, immutable assets and versioned models only', () => {
		expect(cacheKind('/_app/immutable/chunks/a.js', '', shell)).toBe('shell');
		expect(cacheKind('/fonts/ibm-plex-sans-var.woff2', '', shell)).toBe('shell');
		expect(cacheKind('/api/templates/abc/model.glb', '?v=3', shell)).toBe('model');
		expect(cacheKind('/api/templates/abc/hardware.glb', '?v=k1', shell)).toBe('model');
	});
	it('never caches an unversioned model, API data, auth, SSE or camera', () => {
		expect(cacheKind('/api/templates/abc/model.glb', '', shell)).toBeNull();
		expect(cacheKind('/api/health', '', shell)).toBeNull();
		expect(cacheKind('/api/builds/1', '', shell)).toBeNull();
		expect(cacheKind('/api/builds/1/events', '', shell)).toBeNull();
		expect(cacheKind('/api/auth/get-session', '', shell)).toBeNull();
		expect(cacheKind('/api/printers/1/camera', '', shell)).toBeNull();
		expect(cacheKind('/builds/1', '', shell)).toBeNull();
		expect(cacheKind('/invite/x', '', shell)).toBeNull();
	});
	it('answers a failed page navigation, but not API or invite navigations', () => {
		expect(isOfflineFallbackRequest('navigate', '/builds/1')).toBe(true);
		expect(isOfflineFallbackRequest('navigate', '/api/builds/1/export')).toBe(false);
		expect(isOfflineFallbackRequest('navigate', '/invite/abc')).toBe(false);
		expect(isOfflineFallbackRequest('cors', '/builds/1')).toBe(false);
	});
});

describe('update prompt', () => {
	it('shows once, repeats at most every 30 minutes, and never reloads by itself', () => {
		let t = 0;
		const show = vi.fn();
		const accept = vi.fn();
		const p = createUpdatePrompter({ show, now: () => t }, accept);
		expect(p.waiting(true)).toBe(true);
		expect(show).toHaveBeenCalledWith(accept);
		t += 60_000;
		expect(p.waiting()).toBe(false);
		t += UPDATE_CHECK_MS;
		expect(p.waiting()).toBe(true);
		expect(show).toHaveBeenCalledTimes(2);
		expect(accept).not.toHaveBeenCalled();
	});
});

describe('runtime cache bound', () => {
	it('evicts only what exceeds the maximum, oldest first', () => {
		expect(RUNTIME_MAX_ENTRIES).toBe(12);
		expect(evictCount(5)).toBe(0);
		expect(evictCount(12)).toBe(0);
		expect(evictCount(15)).toBe(3);
	});
});

describe('clearPrivateCaches', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('does nothing and does not throw without CacheStorage', async () => {
		vi.stubGlobal('caches', undefined);
		await expect(clearPrivateCaches()).resolves.toBeUndefined();
	});
	it('is fine when nothing is cached', async () => {
		const del = vi.fn().mockResolvedValue(false);
		vi.stubGlobal('caches', { delete: del });
		await expect(clearPrivateCaches()).resolves.toBeUndefined();
		expect(del).toHaveBeenCalledWith(RUNTIME_CACHE);
	});
	it('deletes only the runtime cache, leaving the shell precache', async () => {
		const store = new Set([RUNTIME_CACHE, 'tmt-shell-abc']);
		vi.stubGlobal('caches', { delete: async (k: string) => store.delete(k) });
		await clearPrivateCaches();
		expect([...store]).toEqual(['tmt-shell-abc']);
	});
	it('never throws when deleting fails', async () => {
		vi.stubGlobal('caches', { delete: () => Promise.reject(new Error('denied')) });
		await expect(clearPrivateCaches()).resolves.toBeUndefined();
	});
});
