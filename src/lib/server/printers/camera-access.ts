/** Glue for the camera routes: access checks, cached source lookup, the hub session for a printer. */
import { ApiError, requireMember } from '../access';
import type { Db } from '../db';
import { json } from '@sveltejs/kit';
import { CameraError, getCameraHub, type CameraSession } from './camera';
import { resolveCameraSource, toCameraTarget, type CameraSource } from './camera-source';
import { shareLinkFor, shareLinkOf } from '#lib/printers/share-link.ts';
import { enableSdcpCamera } from './adapters/sdcp';
import { assertOutboundAllowed } from './outbound';
import { getSupervisor } from './supervisor';
import { getPrinter, toConfig } from './store';
import type { PrinterConfig } from './types';

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; src: CameraSource | null }>();

/** Printer camera settings changed: forget the resolved source and drop the live connection. */
export function cameraChanged(printerId: string) {
	cache.delete(printerId);
	getCameraHub().invalidate(printerId);
}

/** Resolve (cached for a minute: Moonraker/OctoPrint are asked over HTTP) the printer's camera. */
export async function sourceFor(db: Db, printerId: string): Promise<CameraSource | null> {
	const row = getPrinter(db, printerId);
	assertCameraAllowed(row);
	const hit = cache.get(printerId);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.src;
	if (!row) return null;
	const src = await resolveCameraSource(toCameraTarget(row));
	cache.set(printerId, { at: Date.now(), src });
	return src;
}

/** Members of the printer's workspace only; everyone else (and unknown ids) gets 404. */
export function printerForMember(db: Db, printerId: string, userId: string) {
	const row = getPrinter(db, printerId);
	if (!row) throw new ApiError(404, 'Not found');
	const role = requireMember(db, row.organizationId, userId);
	return { row, role };
}

/** Hosted site: only a printer reached through an OctoEverywhere link has a camera. */
function assertCameraAllowed(row: ReturnType<typeof getPrinter>): void {
	assertOutboundAllowed({
		allowShareLink: !!row && !!shareLinkFor(row.kind, toConfig(row).secrets)
	});
}

export function sessionFor(db: Db, printerId: string): CameraSession {
	const row = getPrinter(db, printerId);
	assertCameraAllowed(row);
	return getCameraHub().session(
		printerId,
		async () => {
			// A failed lookup is not cached forever: a missing source is retried by the session backoff.
			const src = await sourceFor(db, printerId);
			if (!src) cache.delete(printerId);
			return src;
		},
		row?.kind === 'elegoo-sdcp' && !shareLinkOf(toConfig(row).secrets)
			? () => enableElegooCamera(db, printerId)
			: undefined
	);
}

/** JSON error for the binary camera routes (they cannot use `respond`). */
export function cameraFail(e: unknown): Response {
	if (e instanceof ApiError) return json({ error: e.message }, { status: e.status });
	if (e instanceof CameraError) return json({ error: e.message }, { status: 502 });
	console.error('[tmt] camera error', e instanceof Error ? e.name : '');
	return json({ error: 'Internal error' }, { status: 500 });
}

/** Printer names go into one log line: no control characters. */
const logName = (n: string) =>
	[...n]
		.map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
		.join('')
		.slice(0, 80);

/**
 * Elegoo only, and only SDCP Cmd 386 `{Enable:1}`: over the supervisor's open socket when the
 * printer has one (it limits clients), else a short-lived socket of our own. Logs one line.
 */
export async function enableElegooCamera(db: Db, printerId: string): Promise<boolean> {
	const row = getPrinter(db, printerId);
	if (!row || row.kind !== 'elegoo-sdcp') return false;
	if (shareLinkOf(toConfig(row).secrets)) return false; // OctoEverywhere: no Cmd 386
	let ok = await getSupervisor()?.enableCamera(printerId);
	if (ok === null || ok === undefined) ok = await enableSdcpCamera(toConfig(row));
	if (ok) console.log(`[tmt] camera: enabled video on ${logName(row.name)}`);
	return ok;
}

/** Settings "Test" for an unsaved/typed Elegoo config: temporary socket, throttled per host. */
export function testEnabler(cfg: PrinterConfig) {
	if (cfg.kind !== 'elegoo-sdcp' || shareLinkOf(cfg.secrets)) return undefined;
	return getCameraHub().throttledEnabler(`test:${cfg.host}:${cfg.port ?? ''}`, async () => {
		const ok = await enableSdcpCamera(cfg);
		if (ok) console.log(`[tmt] camera: enabled video on ${logName(cfg.host)}`);
		return ok;
	});
}
