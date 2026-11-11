import { toasts } from '#lib/components/toast.svelte.ts';
import { RUNTIME_CACHE } from './sw-rules.ts';

/**
 * Update prompt for the service worker that SvelteKit registers (`src/service-worker.ts`).
 * Capability is detected, never assumed: plain-http LAN pages (not a secure context) have no
 * `navigator.serviceWorker`, and then this does nothing at all.
 */
export const UPDATE_CHECK_MS = 30 * 60 * 1000;
const RE_PROMPT_MS = 30 * 60 * 1000;

export interface PromptDeps {
	/** Show the prompt; `reload` runs when the person presses Reload. */
	show: (reload: () => void) => void;
	now: () => number;
}

/**
 * Decides when to (re)show the prompt for a waiting worker. A page without a toast host (sign-in)
 * would miss a single prompt, so it is repeated when the app comes back to the foreground, at
 * most every 30 minutes. Never reloads by itself.
 */
export function createUpdatePrompter(deps: PromptDeps, accept: () => void) {
	let shownAt = -Infinity;
	return {
		/** A worker is waiting. `force` is the first sighting, otherwise a throttled reminder. */
		waiting(force = false) {
			const t = deps.now();
			if (!force && t - shownAt < RE_PROMPT_MS) return false;
			shownAt = t;
			deps.show(accept);
			return true;
		}
	};
}

export function initPwa(): void {
	if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
	const sw = navigator.serviceWorker;
	let accepted = false;
	let reg: ServiceWorkerRegistration | undefined;

	const prompter = createUpdatePrompter(
		{
			show: (reload) => {
				toasts.push('A new version is available.', { label: 'Reload', run: reload }, 60_000);
			},
			now: () => Date.now()
		},
		() => {
			const w = reg?.waiting;
			if (!w) {
				location.reload();
				return;
			}
			accepted = true;
			w.postMessage({ type: 'SKIP_WAITING' });
		}
	);

	// The new worker takes over: reload once, and only because the person asked.
	sw.addEventListener('controllerchange', () => {
		if (accepted) location.reload();
	});

	const watch = (r: ServiceWorkerRegistration) => {
		reg = r;
		// A worker already waiting when the page opened (needs a controller: otherwise it is the first install).
		if (r.waiting && sw.controller) prompter.waiting(true);
		r.addEventListener('updatefound', () => {
			const next = r.installing;
			next?.addEventListener('statechange', () => {
				if (next.state === 'installed' && sw.controller) prompter.waiting(true);
			});
		});
	};

	// SvelteKit registers the worker on startup; wait for that rather than registering twice.
	sw.ready.then(watch).catch(() => {});

	let lastCheck = Date.now();
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState !== 'visible' || !reg) return;
		if (reg.waiting && sw.controller) prompter.waiting();
		if (Date.now() - lastCheck > UPDATE_CHECK_MS) {
			lastCheck = Date.now();
			reg.update().catch(() => {});
		}
	});
}

/**
 * Drops the worker's runtime cache (kit model GLBs, which can be a private copy's) so nothing of a
 * signed-out person stays on a shared device. The versioned shell precache is kept. Safe without
 * `caches` (plain http) or with nothing cached; never throws.
 */
export async function clearPrivateCaches(): Promise<void> {
	try {
		if (typeof caches === 'undefined') return;
		await caches.delete(RUNTIME_CACHE);
	} catch {
		// Nothing useful to do: the next sign-out tries again.
	}
}
