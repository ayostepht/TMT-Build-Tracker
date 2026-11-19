/**
 * Coalesces automatic background loads (export preview, plate arrangement) that re-run on every
 * live view update. Those reads count against the server's per-user expensive-read budget
 * (`acquireExpensiveReadSlot` in `src/lib/server/quota.ts`), so a burst of updates must not turn
 * into a burst of requests whose results are thrown away:
 *
 * - `schedule(task)` waits `delayMs` (trailing debounce); a newer task replaces a waiting one.
 * - At most one task runs at a time. A task scheduled while one runs waits for it to finish,
 *   then only the latest waiting task runs.
 * - `cancel()` drops the waiting task (call it when the component unmounts).
 *
 * Tasks handle their own errors; a rejection is swallowed here so the queue keeps going.
 */
/** Seconds to wait before one retry after a 429 (`Retry-After` when sent, else 5, at most 60). */
export function busyRetrySeconds(e: unknown): number | null {
	const x = e as { status?: number; retryAfter?: number | null } | null;
	if (!x || x.status !== 429) return null;
	return Math.min(60, x.retryAfter && x.retryAfter > 0 ? x.retryAfter : 5);
}

export interface Coalescer {
	schedule(task: () => Promise<unknown>): void;
	cancel(): void;
}

export function createCoalescer(delayMs = 150): Coalescer {
	let pending: (() => Promise<unknown>) | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let running = false;

	function arm() {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(flush, delayMs);
	}

	async function flush() {
		timer = null;
		const task = pending;
		pending = null;
		if (!task) return;
		running = true;
		try {
			await task();
		} catch {
			/* the task reports its own errors */
		} finally {
			running = false;
			if (pending) arm();
		}
	}

	return {
		schedule(task) {
			pending = task;
			if (!running) arm();
		},
		cancel() {
			pending = null;
			if (timer !== null) clearTimeout(timer);
			timer = null;
		}
	};
}
