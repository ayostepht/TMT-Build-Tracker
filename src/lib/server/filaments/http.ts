import { json, type RequestEvent } from '@sveltejs/kit';
import { requireUserId } from '#lib/server/api.ts';
import { ApiError } from '#lib/server/access.ts';

/** Signed-in only, JSON, cacheable for a day (the catalog only changes with a release). */
export function catalogResponse(event: RequestEvent, body: () => unknown): Response {
	try {
		requireUserId(event);
		return json(body(), { headers: { 'cache-control': 'private, max-age=86400' } });
	} catch (e) {
		if (e instanceof ApiError) return json({ error: e.message }, { status: e.status });
		throw e;
	}
}
