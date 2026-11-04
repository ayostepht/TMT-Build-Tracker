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
