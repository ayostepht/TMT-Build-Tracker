import { getDb } from '#lib/server/db/index.ts';
import { ApiError } from '#lib/server/access.ts';
import { importPrototype, previewPrototype } from '#lib/server/builds/import.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

const MAX_BYTES = 2 * 1024 * 1024;

export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const text = await event.request.text();
		if (text.length > MAX_BYTES) throw new ApiError(413, 'The export is larger than 2 MB');
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			throw new ApiError(400, 'Invalid JSON');
		}
		if (typeof body !== 'object' || body === null || Array.isArray(body) || !('data' in body))
			throw new ApiError(400, 'Expected { data, replace? }');
		const { data, replace } = body as { data: unknown; replace?: unknown };
		const db = getDb();
		if (event.url.searchParams.get('dryRun') === '1')
			return previewPrototype(db, event.params.id, userId, data);
		return importPrototype(db, event.params.id, userId, data, { replace: replace === true });
	});
