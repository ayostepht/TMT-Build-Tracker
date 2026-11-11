export interface BuildChangeEvent {
	type: 'changed';
	kind: string;
	by: string | null;
	at: string;
}
/** Minimum gap between resync refreshes. */
export const RESYNC_THROTTLE_MS = 2000;
export type LiveStatus = 'live' | 'reconnecting';

/**
 * Subscribe to a build's server-sent events. EventSource reconnects by itself
 * (server sends `retry: 3000`); `onStatus` reports connection state for the sync dot.
 * Returns an unsubscribe function.
 */
export function subscribeBuild(
	buildId: string,
	onChange: (e: BuildChangeEvent) => void,
	opts: { onStatus?: (s: LiveStatus) => void; onResync?: () => void } = {}
): () => void {
	let es: EventSource | null = null;
	let closed = false;
	let everOpened = false;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let lastResync = 0;

	// A phone suspends the stream in the background and misses events: refetch when the stream
	// re-opens or the tab/network is back. Throttled so several triggers cause one refresh.
	const resync = () => {
		if (closed || !opts.onResync) return;
		if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
		const now = Date.now();
		if (now - lastResync < RESYNC_THROTTLE_MS) return;
		lastResync = now;
		try {
			opts.onResync();
		} catch {
			/* a failed refresh must not break the subscription */
		}
	};
	const canListen = typeof document !== 'undefined' && typeof window !== 'undefined';
	if (canListen) {
		document.addEventListener('visibilitychange', resync);
		window.addEventListener('online', resync);
		window.addEventListener('focus', resync);
	}

	const open = () => {
		if (closed) return;
		es = new EventSource(`/api/builds/${encodeURIComponent(buildId)}/events`);
		es.onopen = () => {
			opts.onStatus?.('live');
			// Not on the very first open: the page data is fresh then.
			if (everOpened) resync();
			everOpened = true;
		};
		es.onmessage = (m) => {
			try {
				onChange(JSON.parse(m.data) as BuildChangeEvent);
			} catch {
				/* ignore malformed */
			}
		};
		es.onerror = () => {
			opts.onStatus?.('reconnecting');
			// CLOSED means the browser gave up (e.g. 401/404 or server error): retry manually.
			if (es && es.readyState === EventSource.CLOSED) {
				es.close();
				clearTimeout(retry);
				retry = setTimeout(open, 5000);
			}
		};
	};
	open();
	return () => {
		closed = true;
		if (canListen) {
			document.removeEventListener('visibilitychange', resync);
			window.removeEventListener('online', resync);
			window.removeEventListener('focus', resync);
		}
		clearTimeout(retry);
		es?.close();
	};
}
