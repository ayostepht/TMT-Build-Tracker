/**
 * Keeps one adapter connection per enabled printer, mirrors the latest status into the
 * `printers` row (throttled), pushes it to the team's SSE stream and feeds the job lifecycle.
 * One instance per process (`getSupervisor`); started from `startup()`.
 */
import { eq } from 'drizzle-orm';
import type { PrinterStatus } from '#lib/printers/status.ts';
import { isPublicMode } from '../config';
import type { Db } from '../db';
import { printers } from '../db/schema';
import { adapters as defaultAdapters } from './adapters';
import { emitPrinterEvent } from './bus';
import { processStatus } from './jobs';
import { PUBLIC_MODE_MESSAGE } from './outbound';
import { toConfig } from './store';
import type { AdapterHandle, ConnectFn } from './types';
import type { PrinterKind } from '#lib/printers/status.ts';

const WRITE_EVERY_MS = 10_000;

interface Conn {
	handle: AdapterHandle;
	unsub: () => void;
	lastWrite: number;
	lastKey: string;
}

export class Supervisor {
	private conns = new Map<string, Conn>();
	constructor(
		private db: Db,
		private adapters: Record<PrinterKind, ConnectFn> = defaultAdapters,
		private writeEveryMs = WRITE_EVERY_MS
	) {}

	/** Connect every enabled printer. */
	start(): void {
		for (const p of this.db.select().from(printers).where(eq(printers.enabled, true)).all())
			this.connect(p.id);
	}

	/** (Re)connect one printer after it was added or edited; disconnect when disabled or deleted. */
	refresh(printerId: string): void {
		this.disconnect(printerId);
		const row = this.db.select().from(printers).where(eq(printers.id, printerId)).get();
		if (row?.enabled) this.connect(printerId);
	}

	private connect(printerId: string): void {
		if (isPublicMode()) return; // hosted site: no printer connection is ever started
		if (this.conns.has(printerId)) return;
		const row = this.db.select().from(printers).where(eq(printers.id, printerId)).get();
		if (!row) return;
		const cfg = toConfig(row);
		let handle: AdapterHandle;
		try {
			handle = this.adapters[cfg.kind](cfg);
		} catch (e) {
			console.error('[tmt] printer connect failed', row.name, e instanceof Error ? e.message : '');
			return;
		}
		const conn: Conn = { handle, unsub: () => {}, lastWrite: 0, lastKey: '' };
		conn.unsub = handle.status$((s) => this.onStatus(printerId, conn, s));
		this.conns.set(printerId, conn);
	}

	/**
	 * Camera on (Elegoo SDCP) over the printer's existing connection. Null when there is no
	 * connection or the adapter has no such command (the caller may use a temporary socket).
	 */
	async enableCamera(printerId: string): Promise<boolean | null> {
		const fn = this.conns.get(printerId)?.handle.enableCamera;
		return fn ? fn() : null;
	}

	/** Drop a connection (printer deleted). */
	remove(printerId: string): void {
		this.disconnect(printerId);
	}

	private disconnect(printerId: string): void {
		const c = this.conns.get(printerId);
		if (!c) return;
		c.unsub();
		c.handle.close();
		this.conns.delete(printerId);
	}

	private onStatus(printerId: string, conn: Conn, s: PrinterStatus): void {
		try {
			const now = Date.now();
			const row = this.db
				.select({ org: printers.organizationId })
				.from(printers)
				.where(eq(printers.id, printerId))
				.get();
			if (!row) return this.disconnect(printerId);
			const key = `${s.state}|${s.fileName ?? ''}`;
			if (key !== conn.lastKey || now - conn.lastWrite >= this.writeEveryMs) {
				conn.lastKey = key;
				conn.lastWrite = now;
				const set: Partial<typeof printers.$inferInsert> = {
					lastStatus: s as unknown as Record<string, unknown>
				};
				if (s.state !== 'offline') set.lastSeenAt = new Date(now);
				this.db.update(printers).set(set).where(eq(printers.id, printerId)).run();
			}
			const jobsChanged =
				s.state !== 'offline' && processStatus(this.db, printerId, s, new Date(now)).changed;
			// A job started, linked or finished: open pages reload their job list (the Now printing tile).
			if (jobsChanged) emitPrinterEvent(row.org, { type: 'job', printerId });
			emitPrinterEvent(row.org, {
				type: 'status',
				printerId,
				status: s,
				lastSeenAt: s.state !== 'offline' ? new Date(now).toISOString() : undefined
			});
		} catch (e) {
			console.error('[tmt] printer status error', e instanceof Error ? e.message : e);
		}
	}

	stop(): void {
		for (const id of [...this.conns.keys()]) this.disconnect(id);
	}

	get size(): number {
		return this.conns.size;
	}
}

const KEY = Symbol.for('tmt.printer-supervisor');
type G = typeof globalThis & { [KEY]?: Supervisor };
const g = globalThis as G;

export function startSupervisor(db: Db): Supervisor {
	if (!g[KEY]) {
		g[KEY] = new Supervisor(db);
		g[KEY].start();
	}
	return g[KEY];
}

/** The running supervisor, or null before startup. */
export function getSupervisor(): Supervisor | null {
	return g[KEY] ?? null;
}

/**
 * One-shot connection test: connect, wait for the first real status (or the timeout), then
 * disconnect. Never touches the database.
 */
export async function testConnection(
	cfg: import('./types').PrinterConfig,
	timeoutMs = 8000,
	adapters: Record<PrinterKind, ConnectFn> = defaultAdapters
): Promise<{ ok: boolean; status: PrinterStatus | null; message?: string }> {
	if (isPublicMode()) return { ok: false, status: null, message: PUBLIC_MODE_MESSAGE };
	return new Promise((resolve) => {
		let last: PrinterStatus | null = null;
		let handle: AdapterHandle | null = null;
		let finished = false;
		const done = (ok: boolean) => {
			if (finished) return;
			finished = true;
			clearTimeout(t);
			unsub();
			handle?.close();
			resolve({
				ok,
				status: last,
				message: ok
					? undefined
					: (last?.message ?? 'No answer from the printer. Check the address and that it is on.')
			});
		};
		let unsub = () => {};
		const t = setTimeout(() => done(false), timeoutMs);
		try {
			handle = adapters[cfg.kind](cfg);
		} catch {
			return done(false);
		}
		unsub = handle.status$((s) => {
			last = s;
			if (s.state === 'error') done(false);
			else if (s.state !== 'offline') done(true);
		});
		if (finished) unsub();
	});
}
