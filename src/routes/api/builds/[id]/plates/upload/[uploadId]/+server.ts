import { getDb } from '#lib/server/db/index.ts';
import { discardUpload } from '#lib/server/builds/plates.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = (event) =>
	respond(() =>
		discardUpload(getDb(), event.params.id, requireUserId(event), event.params.uploadId)
	);
