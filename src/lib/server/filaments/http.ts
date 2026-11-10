import { json, type RequestEvent } from '@sveltejs/kit';
import { requireUserId } from '#lib/server/api.ts';
import { ApiError } from '#lib/server/access.ts';
import { meta } from './index.ts';

/**
 * Validator for the bundled catalog: it only changes with a release, and a release that changes it
 * regenerates `fetchedAt`. Browsers must revalidate (no-cache) so a new catalog shows up right after a
 * deploy; an unchanged one costs a 304.
 */
const ETAG = `"cat-${meta().fetchedAt ?? 'none'}"`;

/** Signed-in only, JSON, revalidated against the catalog version on every use. */
export function catalogResponse(event: RequestEvent, body: () => unknown): Response {
	try {
		requireUserId(event);
		const headers = { 'cache-control': 'private, no-cache', etag: ETAG };
		if (event.request.headers.get('if-none-match') === ETAG)
			return new Response(null, { status: 304, headers });
		return json(body(), { headers });
	} catch (e) {
		if (e instanceof ApiError) return json({ error: e.message }, { status: e.status });
		throw e;
	}
}
