import { ApiError } from '#lib/server/access.ts';
import { apiErrorResponse } from '#lib/server/api-file.ts';
import { MAX_GUIDE_PAGE_BYTES, readUploadedPdfPage, saveGuidePage } from '#lib/server/guide.ts';
import { requireAdminForTemplate } from '#lib/server/models/guard.ts';
import { respond } from '#lib/server/api.ts';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Site admin: store the raw image body (JPEG, PNG or WebP, up to 3 MB) as PDF page `n` of the guide. */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		requireAdminForTemplate(event, event.params.id);
		const declared = Number(event.request.headers.get('content-length') ?? '');
		if (Number.isFinite(declared) && declared > MAX_GUIDE_PAGE_BYTES)
			throw new ApiError(413, 'The page image is larger than 3 MB');
		const bytes = new Uint8Array(await event.request.arrayBuffer());
		return await saveGuidePage(event.params.id, event.params.n, bytes);
	});

/** Site admin: the uploaded PDF page image (for the mapping preview). */
export const GET: RequestHandler = async (event) => {
	try {
		requireAdminForTemplate(event, event.params.id);
		const f = await readUploadedPdfPage(event.params.id, event.params.n);
		return new Response(f.bytes as Uint8Array<ArrayBuffer>, {
			headers: { 'content-type': f.type, 'cache-control': 'private, no-cache', etag: f.etag }
		});
	} catch (e) {
		const r = apiErrorResponse(e);
		if (r) return r;
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
