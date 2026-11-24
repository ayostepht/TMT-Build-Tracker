import { getDb } from '#lib/server/db/index.ts';
import { ApiError } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { applyLibraryPiece } from '#lib/server/custom-library.ts';
import { isObj } from '#lib/domain/guards.ts';
import type { RequestHandler } from './$types';

/**
 * `{ libraryId, replaces? }`: add a saved custom part of the workspace to the build (editors; drafts too).
 * `replaces` (kit part slugs of the build, at most 60) replaces the saved part's own list for this add, `[]`
 * skips nothing; absent = the saved settings. Answers `{ pieceId, plates, skipped }`, or `{ already: true }`
 * when the build already holds a piece from it.
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const body = await readJson(event);
		if (!isObj(body) || typeof body.libraryId !== 'string')
			throw new ApiError(400, 'libraryId is required');
		const r = applyLibraryPiece(getDb(), event.params.id, userId, body.libraryId, {
			replaces: body.replaces
		});
		return r ?? { already: true };
	});
