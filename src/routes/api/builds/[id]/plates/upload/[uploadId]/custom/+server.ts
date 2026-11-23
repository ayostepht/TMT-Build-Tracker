import { getDb } from '#lib/server/db/index.ts';
import { addCustomPiece } from '#lib/server/builds/custom-pieces.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/**
 * Add the parsed upload as a custom piece (an accessory or beta replacement) instead of replacing the
 * build's plates: `{ name, plates?, runs?, filamentMap, role?, replaces? }` (editor or owner).
 */
export const POST: RequestHandler = (event) =>
	respond(async () =>
		addCustomPiece(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.uploadId,
			await readJson(event)
		)
	);
