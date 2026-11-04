import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { templateModelPath } from '#lib/server/config.ts';
import type { RequestHandler } from './$types';

/**
 * Streams the template's assembled model (`<dataDir>/uploads/models/<templateId>.glb`).
 * Signed-in users only. The URL carries `?v=<version>`, so it is cached for a year.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Sign in required');
	// The id is a UUID; refuse anything that could walk the path.
	if (!/^[A-Za-z0-9_-]+$/.test(params.id)) error(404, 'Not found');
	const path = templateModelPath(params.id);
	let size: number;
	try {
		const s = await stat(path);
		if (!s.isFile()) error(404, 'Not found');
		size = s.size;
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(404, 'Not found');
	}
	return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
		headers: {
			'content-type': 'model/gltf-binary',
			'content-length': String(size),
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
