import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { session } from './db/auth.schema';
/**
 * Server-sent-events response shared by the live endpoints.
 *
 * - `release` (the per-user connection slot from `acquireSseSlot`) is called exactly once when the
 *   stream ends by cancel, abort, a failed write or a lost permission.
 * - A revoked or expired session closes the stream on the next heartbeat (`sessionValid`).
 * - Access is re-checked on every event before it is sent (a removed member never receives
 *   another one) and on every keep-alive tick (so the connection itself closes within ~25 s and
 *   gives its slot back). One or two indexed lookups per event or tick; idle streams cost almost
 *   nothing, which is cheaper than a periodic poll on its own and, unlike one, never leaks an event.
 */
export const HEARTBEAT_MS = 25_000;

export interface LiveStreamOptions<E> {
	signal: AbortSignal;
	/** Subscribe to events; returns the unsubscribe function. */
	subscribe: (fn: (e: E) => void) => () => void;
	/** Still allowed to listen? Called before each event and on each heartbeat. */
	allowed: () => boolean;
	/** Optional: is the session behind this stream still valid? Checked on each heartbeat only. */
	sessionValid?: () => boolean;
	release: () => void;
	heartbeatMs?: number;
}

export function liveStream<E>(o: LiveStreamOptions<E>): Response {
	const enc = new TextEncoder();
	let cleanup = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let done = false;
			let unsub = () => {};
			const beat = setInterval(() => {
				if (!o.allowed() || (o.sessionValid && !o.sessionValid())) cleanup();
				else send(': keepalive\n\n');
			}, o.heartbeatMs ?? HEARTBEAT_MS);
			cleanup = () => {
				if (done) return;
				done = true;
				clearInterval(beat);
				unsub();
				o.release();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};
			function send(s: string) {
				try {
					controller.enqueue(enc.encode(s));
				} catch {
					cleanup();
				}
			}
			unsub = o.subscribe((e) => {
				if (!o.allowed()) return cleanup();
				send(`data: ${JSON.stringify(e)}\n\n`);
			});
			if (o.signal.aborted) return cleanup();
			o.signal.addEventListener('abort', cleanup);
			send('retry: 3000\n: connected\n\n');
		},
		cancel() {
			cleanup();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
}

/**
 * True while the session row still exists and has not expired (sign-out, "revoke other sessions"
 * and account deletion remove it). One lookup by primary key.
 */
export function sessionStillValid(db: Db, sessionId: string | null | undefined): boolean {
	if (!sessionId) return false;
	const s = db
		.select({ expiresAt: session.expiresAt })
		.from(session)
		.where(eq(session.id, sessionId))
		.get();
	return !!s && s.expiresAt.getTime() > Date.now();
}
