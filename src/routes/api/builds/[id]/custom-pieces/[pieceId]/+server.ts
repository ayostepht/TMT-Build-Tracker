import { getDb } from '#lib/server/db/index.ts';
import { removeCustomPiece, renameCustomPiece } from '#lib/server/builds/custom-pieces.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Remove a custom piece; `?restore=1` also brings back the kit parts it replaced (editor or owner). */
export const DELETE: RequestHandler = (event) =>
	respond(async () =>
		removeCustomPiece(getDb(), event.params.id, requireUserId(event), event.params.pieceId, {
			restore: event.url.searchParams.get('restore') === '1'
		})
	);

/** `{ name }`: rename a custom piece, its parts and its plates (editor or owner; not for drafts). */
export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		renameCustomPiece(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.pieceId,
			await readJson(event)
		)
	);
