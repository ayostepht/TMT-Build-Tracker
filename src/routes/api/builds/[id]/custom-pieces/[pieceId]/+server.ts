import { getDb } from '#lib/server/db/index.ts';
import {
	recolorCustomPiece,
	removeCustomPiece,
	renameCustomPiece
} from '#lib/server/builds/custom-pieces.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { isObj } from '#lib/domain/guards.ts';
import type { RequestHandler } from './$types';

/** Remove a custom piece; `?restore=1` also brings back the kit parts it replaced (editor or owner). */
export const DELETE: RequestHandler = (event) =>
	respond(async () =>
		removeCustomPiece(getDb(), event.params.id, requireUserId(event), event.params.pieceId, {
			restore: event.url.searchParams.get('restore') === '1'
		})
	);

/**
 * `{ name }`: rename a custom piece, its parts and its plates; or `{ roles: { "<part slug>": { "<current role>":
 * "<new role>" } } }`: change the color(s) of its parts (answers `{ changes }`). Editor or owner; drafts too.
 */
export const PATCH: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const body = await readJson(event);
		return isObj(body) && body.roles !== undefined
			? recolorCustomPiece(getDb(), event.params.id, userId, event.params.pieceId, body)
			: renameCustomPiece(getDb(), event.params.id, userId, event.params.pieceId, body);
	});
