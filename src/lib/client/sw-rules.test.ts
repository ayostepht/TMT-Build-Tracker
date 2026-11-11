import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cacheKind,
	evictCount,
	isCacheableResponse,
	isOfflineFallbackRequest,
	isPrecacheExcluded,
	RUNTIME_CACHE,
	RUNTIME_MAX_ENTRIES
} from './sw-rules.ts';
import { getView } from './api.ts';
import { clearPrivateCaches, createUpdatePrompter, UPDATE_CHECK_MS } from './pwa.ts';

const shell = ['/fonts/ibm-plex-sans-var.woff2', '/offline.html', '/icons/icon-192.png'];

describe('service worker rules', () => {
	it('caches the shell, immutable assets and versioned models only', () => {
		const list = [...shell, '/_app/immutable/chunks/a.js'];
		expect(cacheKind('/_app/immutable/chunks/a.js', '', list)).toBe('shell');
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

describe('shell rule is exact membership', () => {
	it('does not cache an immutable path that is not in the precache list', () => {
		expect(cacheKind('/_app/immutable/chunks/other.js', '', shell)).toBeNull();
		const list = [...shell, '/_app/immutable/chunks/a.js'];
		expect(cacheKind('/_app/immutable/chunks/a.js', '', list)).toBe('shell');
	});
	it('refuses percent-encoded and dot-dot paths, even under the prefix', () => {
		const list = [...shell, '/_app/immutable/chunks/a.js'];
		expect(cacheKind('/_app/immutable/..%2fapi/builds', '', list)).toBeNull();
		expect(cacheKind('/_app/immutable/%2e%2e/api/x', '', list)).toBeNull();
		expect(cacheKind('/_app/immutable/../api/x', '', list)).toBeNull();
		expect(cacheKind('/offline%2ehtml', '', list)).toBeNull();
	});
	it('stores only basic 200 responses', () => {
		expect(isCacheableResponse({ type: 'basic', status: 200 })).toBe(true);
		expect(isCacheableResponse({ type: 'opaque', status: 0 })).toBe(false);
		expect(isCacheableResponse({ type: 'cors', status: 200 })).toBe(false);
		expect(isCacheableResponse({ type: 'basic', status: 404 })).toBe(false);
		expect(isCacheableResponse({ type: 'basic', status: 206 })).toBe(false);
	});
	it('leaves the pdf.js worker and robots.txt out of the precache', () => {
		expect(isPrecacheExcluded('/_app/immutable/assets/pdf.worker.min.CIqJB0yW.mjs')).toBe(true);
		expect(isPrecacheExcluded('/robots.txt')).toBe(true);
		expect(isPrecacheExcluded('/_app/immutable/assets/app.abc.css')).toBe(false);
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

describe('401 clears private caches', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('deletes the runtime cache when an API call is unauthorised', async () => {
		const del = vi.fn().mockResolvedValue(true);
		vi.stubGlobal('caches', { delete: del });
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'no' }) })
		);
		await expect(getView('b1')).rejects.toThrow('no');
		await Promise.resolve();
		expect(del).toHaveBeenCalledWith(RUNTIME_CACHE);
	});
	it('leaves it alone on other errors and successes', async () => {
		const del = vi.fn().mockResolvedValue(true);
		vi.stubGlobal('caches', { delete: del });
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
		);
		await expect(getView('b1')).rejects.toThrow();
		expect(del).not.toHaveBeenCalled();
	});
	it('does not break the call when caches is missing', async () => {
		vi.stubGlobal('caches', undefined);
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'x' }) })
		);
		await expect(getView('b1')).rejects.toThrow('x');
	});
});
