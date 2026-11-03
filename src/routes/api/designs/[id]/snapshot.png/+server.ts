import { error } from '@sveltejs/kit';
import { ApiError } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { findDesign } from '#lib/server/designs/designs.ts';
import { readSnapshot } from '#lib/server/designs/files.ts';
import type { RequestHandler } from './$types';

/** The design's PNG preview, for anyone who may see the design. 404 when it has none. */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Sign in required');
	let id: string;
	try {
		id = findDesign(getDb(), params.id, locals.user.id).id;
	} catch (e) {
		if (e instanceof ApiError) error(e.status as 404, e.message);
		throw e;
	}
	const bytes = await readSnapshot(id);
	if (!bytes) error(404, 'No preview');
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': 'image/png',
			'content-length': String(bytes.length),
			'cache-control': 'private, max-age=300'
		}
	});
};
