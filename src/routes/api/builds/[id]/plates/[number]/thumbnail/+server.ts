import { getDb } from '#lib/server/db/index.ts';
import { plateThumbnailFile } from '#lib/server/builds/plates.ts';
import { apiErrorResponse, pngResponse } from '#lib/server/api-file.ts';
import { requireUserId } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const n = Number(event.params.number);
		if (!Number.isInteger(n)) return pngResponse(null);
		return await pngResponse(plateThumbnailFile(getDb(), event.params.id, requireUserId(event), n));
	} catch (e) {
		const r = apiErrorResponse(e);
		if (r) return r;
		throw e;
	}
};
