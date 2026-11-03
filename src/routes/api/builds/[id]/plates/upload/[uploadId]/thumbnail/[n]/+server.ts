import { getDb } from '#lib/server/db/index.ts';
import { uploadThumbnailFile } from '#lib/server/builds/plates.ts';
import { apiErrorResponse, pngResponse } from '#lib/server/api-file.ts';
import { requireUserId } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const n = Number(event.params.n);
		if (!Number.isInteger(n)) return pngResponse(null);
		return await pngResponse(
			uploadThumbnailFile(getDb(), event.params.id, requireUserId(event), event.params.uploadId, n)
		);
	} catch (e) {
		const r = apiErrorResponse(e);
		if (r) return r;
		throw e;
	}
};
