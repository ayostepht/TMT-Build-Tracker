import { cameraSupported } from '#lib/printers/camera-url.ts';
import type { PrinterKind } from '#lib/printers/status.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { printerForMember, sourceFor } from '#lib/server/printers/camera-access.ts';
import type { RequestHandler } from './$types';

/** Does this printer have a camera right now (members)? The UI shows its tile only when it does. */
export const GET: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const { row } = printerForMember(db, event.params.id, requireUserId(event));
		const supported = cameraSupported(row.kind as PrinterKind);
		const src = supported && row.cameraEnabled ? await sourceFor(db, row.id) : null;
		return {
			supported,
			enabled: row.cameraEnabled,
			available: !!src,
			origin: src?.origin ?? null
		};
	});
