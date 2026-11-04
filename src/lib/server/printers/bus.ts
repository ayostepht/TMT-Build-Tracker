import { EventEmitter } from 'node:events';
import type { PrinterStatus } from '#lib/printers/status.ts';

export interface PrinterEvent {
	type: 'status' | 'job' | 'config';
	printerId: string;
	status?: PrinterStatus;
	lastSeenAt?: string;
}

const KEY = Symbol.for('tmt.printer-events');
type G = typeof globalThis & { [KEY]?: EventEmitter };
const g = globalThis as G;
const bus = (g[KEY] ??= new EventEmitter().setMaxListeners(0));

/** Team-level printer event stream (printers page, Now printing cards). Keyed by organization id. */
export function emitPrinterEvent(orgId: string, e: PrinterEvent): void {
	bus.emit(orgId, e);
}
export function subscribePrinterEvents(orgId: string, fn: (e: PrinterEvent) => void): () => void {
	bus.on(orgId, fn);
	return () => bus.off(orgId, fn);
}
