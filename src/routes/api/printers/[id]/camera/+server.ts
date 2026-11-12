import { cameraSupported } from '#lib/printers/camera-url.ts';
import type { PrinterKind } from '#lib/printers/status.ts';
import { ApiError } from '#lib/server/access.ts';
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
		// Hosted site: only a printer on an OctoEverywhere link has a camera; for any other the
		// refusal means no tile (sourceFor throws a 403 there, which is "no camera" here).
		let src = null;
		if (supported && row.cameraEnabled)
			try {
				src = await sourceFor(db, row.id);
			} catch (e) {
				if (!(e instanceof ApiError)) throw e;
			}
		return {
			supported,
			enabled: row.cameraEnabled,
			available: !!src,
			origin: src?.origin ?? null
		};
	});
