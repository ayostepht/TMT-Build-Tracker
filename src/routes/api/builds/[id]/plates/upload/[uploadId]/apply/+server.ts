import { getDb } from '#lib/server/db/index.ts';
import { applyUpload } from '#lib/server/builds/plates.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	respond(async () =>
		applyUpload(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.uploadId,
			await readJson(event)
		)
	);
