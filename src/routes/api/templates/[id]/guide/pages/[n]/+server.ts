import { ApiError } from '#lib/server/access.ts';
import { apiErrorResponse } from '#lib/server/api-file.ts';
import { MAX_GUIDE_PAGE_BYTES, readUploadedPdfPage, saveGuidePage } from '#lib/server/guide.ts';
import { getDb } from '#lib/server/db/index.ts';
import { acquireUploadSlot } from '#lib/server/quota.ts';
import { admitKitUpload } from '#lib/server/templates/kit-upload.ts';
import { requireAdminForTemplate } from '#lib/server/models/guard.ts';
import { respond } from '#lib/server/api.ts';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Read a request body of at most `max` bytes (413 beyond), without trusting Content-Length. */
async function readBounded(request: Request, max: number): Promise<Uint8Array> {
	if (!request.body) return new Uint8Array(0);
	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = request.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > max) {
			await reader.cancel().catch(() => {});
			throw new ApiError(413, 'The page image is larger than 3 MB');
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let o = 0;
	for (const c of chunks) {
		out.set(c, o);
		o += c.length;
	}
	return out;
}

/**
 * Store the raw image body (JPEG, PNG or WebP, up to 3 MB) as PDF page `n` of the guide. Order:
 * upload slot (429), workspace already over (409), disk floor (507), then read the body.
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireAdminForTemplate(event, event.params.id);
		const db = getDb();
		const release = acquireUploadSlot(db, event.locals.user!);
		try {
			admitKitUpload(db, userId, event.params.id);
			const declared = Number(event.request.headers.get('content-length') ?? '');
			if (Number.isFinite(declared) && declared > MAX_GUIDE_PAGE_BYTES)
				throw new ApiError(413, 'The page image is larger than 3 MB');
			const bytes = await readBounded(event.request, MAX_GUIDE_PAGE_BYTES);
			return await saveGuidePage(event.params.id, event.params.n, bytes, { db, userId });
		} finally {
			release();
		}
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
