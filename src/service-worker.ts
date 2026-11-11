/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import {
	cacheKind,
	evictCount,
	isOfflineFallbackRequest,
	OFFLINE_URL,
	RUNTIME_CACHE
} from '#lib/client/sw-rules.ts';

/**
 * Offline support, deliberately small. What it caches: the app shell's build output (hashed
 * JS/CSS, immutable), the static files (fonts, icons, offline page) and, on first use, kit model
 * GLBs whose URL carries `?v=`. What it never touches, so the browser handles it as if there were
 * no worker: `/api/*` (data, auth, SSE streams, camera, uploads, exports), form posts, and HTML
 * documents (they depend on the session; only a *failed* navigation is answered, with the
 * offline page). There is no background sync and no push.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL_CACHE = `tmt-shell-${version}`;
const KEEP = new Set([SHELL_CACHE, RUNTIME_CACHE]);
/** Build files plus statics, minus what an offline shell never needs. */
// Manifest paths come without a leading slash.
const toPath = (f: { path: string }) => `/${f.path.replace(/^\//, '')}`;
const PRECACHE = [...new Set([...immutable, ...assets].map(toPath))].filter(
	(p) => p !== '/robots.txt'
);

/** Keep the model cache bounded (RUNTIME_MAX_ENTRIES, oldest first). */
async function putModel(cache: Cache, req: Request, res: Response) {
	await cache.put(req, res);
	const keys = await cache.keys();
	for (const k of keys.slice(0, evictCount(keys.length))) await cache.delete(k);
}

sw.addEventListener('install', (event) => {
	// No skipWaiting here: the page asks for it (message below) once the person accepts the update prompt.
	event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(PRECACHE)));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) if (!KEEP.has(key)) await caches.delete(key);
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== sw.location.origin) return;

	if (isOfflineFallbackRequest(req.mode, url.pathname)) {
		event.respondWith(
			fetch(req).catch(async () => {
				const page = await caches.match(OFFLINE_URL);
				return page ?? new Response('You are offline.', { status: 503 });
			})
		);
		return;
	}

	const kind = cacheKind(url.pathname, url.search, PRECACHE);
	if (kind === 'shell') {
		event.respondWith(
			(async () => {
				const hit = await caches.match(req, { ignoreSearch: false });
				if (hit) return hit;
				const res = await fetch(req);
				if (res.ok) {
					const copy = res.clone();
					event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put(req, copy)));
				}
				return res;
			})()
		);
	} else if (kind === 'model') {
		// A versioned GLB never changes for its URL; a range or partial response is not cached.
		event.respondWith(
			(async () => {
				const cache = await caches.open(RUNTIME_CACHE);
				const hit = await cache.match(req);
				if (hit) return hit;
				const res = await fetch(req);
				if (res.status === 200 && !req.headers.has('range')) {
					const copy = res.clone();
					event.waitUntil(putModel(cache, req, copy));
				}
				return res;
			})()
		);
	}
	// Anything else: no respondWith, the network handles it.
});
