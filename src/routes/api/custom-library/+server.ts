import { getDb } from '#lib/server/db/index.ts';
import { ApiError } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { listLibrary, saveToLibrary } from '#lib/server/custom-library.ts';
import { isObj } from '#lib/domain/guards.ts';
import type { RequestHandler } from './$types';

/** `?organizationId=`: the workspace's saved custom parts (members). */
export const GET: RequestHandler = (event) =>
	respond(() => {
		const org = event.url.searchParams.get('organizationId');
		if (!org) throw new ApiError(400, 'organizationId is required');
		return { pieces: listLibrary(getDb(), org, requireUserId(event)) };
	});

/** `{ buildId, pieceId, isDefault? }`: save a custom piece of a build for new builds (editors). */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const body = await readJson(event);
		if (!isObj(body) || typeof body.buildId !== 'string' || typeof body.pieceId !== 'string')
			throw new ApiError(400, 'buildId and pieceId are required');
		return {
			piece: saveToLibrary(getDb(), userId, body.buildId, body.pieceId, {
				isDefault: body.isDefault as boolean | undefined
			})
		};
	});
