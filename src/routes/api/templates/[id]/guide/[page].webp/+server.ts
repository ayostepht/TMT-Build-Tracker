import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { apiErrorResponse } from '#lib/server/api-file.ts';
import { readGuidePage } from '#lib/server/guide.ts';
import { requireUserId } from '#lib/server/api.ts';
import { assertTemplateViewable } from '#lib/server/templates/fork.ts';
import type { RequestHandler } from './$types';

/**
 * The image of guide page `page` (our numbering). Any signed-in user: every workspace can use
 * every kit. The content type follows the stored file (WebP unless the browser could only make JPEG).
 */
export const GET: RequestHandler = async (event) => {
	try {
		requireUserId(event);
		assertTemplateViewable(getDb(), event.locals.user!, event.params.id);
		const page = Number(event.params.page);
		if (!Number.isInteger(page)) return json({ error: 'Not found' }, { status: 404 });
		const f = await readGuidePage(getDb(), event.params.id, page);
		if (event.request.headers.get('if-none-match') === f.etag)
			return new Response(null, { status: 304, headers: { etag: f.etag } });
		return new Response(f.bytes as Uint8Array<ArrayBuffer>, {
			headers: {
				'content-type': f.type,
				'cache-control': 'private, no-cache',
				etag: f.etag,
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		const r = apiErrorResponse(e);
		if (r) return r;
		console.error('[tmt] guide image error', e);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
