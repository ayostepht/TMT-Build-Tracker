import { ApiError } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { saveSnapshot } from '#lib/server/designs/designs.ts';
import { MAX_SNAPSHOT_BYTES } from '#lib/server/designs/files.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Body: the PNG itself (`content-type: image/png`, up to 2 MB). Author only. */
export const PUT: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		if (!(event.request.headers.get('content-type') ?? '').startsWith('image/png'))
			throw new ApiError(415, 'Send the preview as image/png');
		const len = Number(event.request.headers.get('content-length') ?? 0);
		if (len > MAX_SNAPSHOT_BYTES) throw new ApiError(413, 'Image is larger than 2 MB');
		const bytes = new Uint8Array(await event.request.arrayBuffer());
		await saveSnapshot(getDb(), event.params.id, userId, bytes);
	});
