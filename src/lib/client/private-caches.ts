import { RUNTIME_CACHE } from './sw-rules.ts';

/** Same-origin tabs tell each other the session is gone. */
export const AUTH_CHANNEL = 'tmt-auth';

/**
 * Drops the worker's runtime cache (kit model GLBs, which can be a private copy's) so nothing of a
 * signed-out person stays on a shared device. The versioned shell precache is kept. Safe without
 * `caches` (plain http) or with nothing cached; never throws. Other open tabs are told over a
 * BroadcastChannel (when the browser has one) so they clear too.
 */
export async function clearPrivateCaches(opts: { broadcast?: boolean } = {}): Promise<void> {
	if (opts.broadcast !== false) {
		try {
			if (typeof BroadcastChannel !== 'undefined') {
				const ch = new BroadcastChannel(AUTH_CHANNEL);
				ch.postMessage('clear');
				ch.close();
			}
		} catch {
			// No channel: only this tab clears.
		}
	}
	try {
		if (typeof caches === 'undefined') return;
		await caches.delete(RUNTIME_CACHE);
	} catch {
		// Nothing useful to do: the next sign-out tries again.
	}
}

/** Clear when another tab signs out (or sees a 401). Returns a stop function. */
export function listenForAuthClear(): () => void {
	try {
		if (typeof BroadcastChannel === 'undefined') return () => {};
		const ch = new BroadcastChannel(AUTH_CHANNEL);
		ch.onmessage = () => void clearPrivateCaches({ broadcast: false });
		return () => ch.close();
	} catch {
		return () => {};
	}
}
