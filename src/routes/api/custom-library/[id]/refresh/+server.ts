import { getDb } from '#lib/server/db/index.ts';
import { ApiError } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { refreshLibraryPiece } from '#lib/server/custom-library.ts';
import { isObj } from '#lib/domain/guards.ts';
import type { RequestHandler } from './$types';

/**
 * `{ organizationId, buildId, pieceId }`: overwrite the saved part (name, time, grams, color and prints of
 * every plate) from the build's custom piece as it is now (editors). The piece must be linked to this saved
 * part; builds that already have the part are not changed.
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const body = await readJson(event);
		if (
			!isObj(body) ||
			typeof body.organizationId !== 'string' ||
			typeof body.buildId !== 'string' ||
			typeof body.pieceId !== 'string'
		)
			throw new ApiError(400, 'organizationId, buildId and pieceId are required');
		return {
			piece: refreshLibraryPiece(
				getDb(),
				userId,
				body.organizationId,
				event.params.id,
				body.buildId,
				body.pieceId
			)
		};
	});
