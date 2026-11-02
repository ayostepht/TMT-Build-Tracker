import { getDb } from '#lib/server/db/index.ts';
import { updatePlate } from '#lib/server/builds/actions.ts';
import { ApiError } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = (event) =>
	respond(async () => {
		const n = Number(event.params.number);
		if (!Number.isInteger(n)) throw new ApiError(400, 'Invalid plate number');
		updatePlate(getDb(), event.params.id, requireUserId(event), n, await readJson(event));
	});
