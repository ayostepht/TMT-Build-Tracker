export interface BuildChangeEvent {
	type: 'changed';
	kind: string;
	by: string | null;
	at: string;
}
export type LiveStatus = 'live' | 'reconnecting';

/**
 * Subscribe to a build's server-sent events. EventSource reconnects by itself
 * (server sends `retry: 3000`); `onStatus` reports connection state for the sync dot.
 * Returns an unsubscribe function.
 */
export function subscribeBuild(
	buildId: string,
	onChange: (e: BuildChangeEvent) => void,
	opts: { onStatus?: (s: LiveStatus) => void } = {}
): () => void {
	let es: EventSource | null = null;
	let closed = false;
	let retry: ReturnType<typeof setTimeout> | undefined;

	const open = () => {
		if (closed) return;
		es = new EventSource(`/api/builds/${encodeURIComponent(buildId)}/events`);
		es.onopen = () => opts.onStatus?.('live');
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
		clearTimeout(retry);
		es?.close();
	};
}
