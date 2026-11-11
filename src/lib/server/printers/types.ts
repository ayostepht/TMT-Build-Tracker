import type { PrinterKind, PrinterStatus } from '#lib/printers/status.ts';

/** Everything an adapter needs to talk to one printer (secrets already decrypted). */
export interface PrinterConfig {
	id: string;
	kind: PrinterKind;
	host: string;
	port: number | null;
	secrets: Record<string, string>;
}

export type StatusCallback = (s: PrinterStatus) => void;

export interface AdapterHandle {
	/** Subscribe to normalised status; the last status is replayed at once. Returns unsubscribe. */
	status$: (cb: StatusCallback) => () => void;
	/** Elegoo SDCP only: send Cmd 386 `{Enable:1}` (camera on). True when it was sent. */
	enableCamera?: () => Promise<boolean>;
	/** Stop and release the connection. */
	close: () => void;
}

export type ConnectFn = (printer: PrinterConfig) => AdapterHandle;

/** Shared plumbing: a replaying subject plus reconnect backoff. */
export class StatusSubject {
	private subs = new Set<StatusCallback>();
	private last: PrinterStatus | null = null;
	closed = false;

	emit(s: PrinterStatus) {
		if (this.closed) return;
		this.last = s;
		for (const cb of [...this.subs]) {
			try {
				cb(s);
			} catch {
				/* subscriber bug must not kill the connection */
			}
		}
	}
	subscribe(cb: StatusCallback): () => void {
		this.subs.add(cb);
		if (this.last) cb(this.last);
		return () => this.subs.delete(cb);
	}
	get current() {
		return this.last;
	}
}

export function backoff(attempt: number, base = 2000, max = 60000): number {
	return Math.min(max, base * 2 ** Math.min(attempt, 6)) + Math.floor(Math.random() * 500);
}

/** Shown when a device sent a message over `MAX_REMOTE_MESSAGE_BYTES` (or a non-text frame). */
export const OVERSIZED_MESSAGE = 'The printer sent an oversized message';

export const HOSTILE_BACKOFF_BASE_MS = 60_000;
export const HOSTILE_BACKOFF_MAX_MS = 15 * 60_000;
/** Normal messages for this long after a reconnect clear the strikes. */
export const HOSTILE_RESET_MS = 10 * 60_000;

/** Delay before reconnecting after `strikes` (>= 1) oversized messages: 60 s doubling to 15 min. */
export function hostileBackoff(strikes: number): number {
	return Math.min(
		HOSTILE_BACKOFF_MAX_MS,
		HOSTILE_BACKOFF_BASE_MS * 2 ** Math.max(0, Math.min(strikes - 1, 10))
	);
}

/**
 * Per-adapter memory of oversized messages. `trip()` counts a strike and returns the long delay;
 * `good()` is called per normal message and forgets the strikes once messages have been normal
 * for `HOSTILE_RESET_MS` since the last strike.
 */
export class HostileGuard {
	private strikes = 0;
	private since = 0;
	constructor(private now: () => number = Date.now) {}
	trip(): number {
		this.strikes++;
		this.since = 0;
		return hostileBackoff(this.strikes);
	}
	good() {
		if (!this.strikes) return;
		const t = this.now();
		if (!this.since) this.since = t;
		else if (t - this.since >= HOSTILE_RESET_MS) this.strikes = 0;
	}
}

export const num = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Temperature that may be a number or a `[target, actual]` pair (older SDCP firmware). */
export function temp(v: unknown): number | undefined {
	if (Array.isArray(v)) return num(v[v.length - 1]);
	const n = num(v);
	return n === undefined ? undefined : Math.round(n * 10) / 10;
}

/** Strip anything that could be a credential from an error before it is shown or logged. */
export function safeError(e: unknown): string {
	const m = e instanceof Error ? e.message : String(e);
	return m.replace(/[A-Za-z0-9+/=_-]{24,}/g, '***').slice(0, 200);
}
