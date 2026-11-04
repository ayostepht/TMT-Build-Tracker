import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { deletePhoto, readPhoto } from '#lib/server/builds/photos.ts';
import { apiErrorResponse } from '#lib/server/api-file.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** The photo (members only); `?thumb=1` for the small version. */
export const GET: RequestHandler = async (event) => {
	try {
		const { bytes, type } = await readPhoto(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.photoId,
			event.url.searchParams.get('thumb') === '1'
		);
		return new Response(bytes as Uint8Array<ArrayBuffer>, {
			headers: {
				'content-type': type,
				'cache-control': 'private, max-age=31536000, immutable',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		const r = apiErrorResponse(e);
		if (r) return r;
		console.error('[tmt] photo error', e);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

/** Delete the photo (editor or owner). */
export const DELETE: RequestHandler = (event) =>
	respond(() => deletePhoto(getDb(), event.params.id, requireUserId(event), event.params.photoId));
