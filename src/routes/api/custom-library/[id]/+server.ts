import { getDb } from '#lib/server/db/index.ts';
import { ApiError } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { deleteLibraryPiece, updateLibraryPiece } from '#lib/server/custom-library.ts';
import { isObj } from '#lib/domain/guards.ts';
import type { RequestHandler } from './$types';

/** `{ organizationId, name?, isDefault? }`: rename a saved part or switch "in new builds by default" (editors). */
export const PATCH: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const body = await readJson(event);
		if (!isObj(body) || typeof body.organizationId !== 'string')
			throw new ApiError(400, 'organizationId is required');
		const { organizationId, ...rest } = body;
		return { piece: updateLibraryPiece(getDb(), userId, organizationId, event.params.id, rest) };
	});

/** `?organizationId=`: delete a saved part; builds keep the pieces they have (editors). */
export const DELETE: RequestHandler = (event) =>
	respond(() => {
		const org = event.url.searchParams.get('organizationId');
		if (!org) throw new ApiError(400, 'organizationId is required');
		deleteLibraryPiece(getDb(), requireUserId(event), org, event.params.id);
		return {};
	});
