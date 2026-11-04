import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { templateHardwarePath } from '#lib/server/config.ts';
import type { RequestHandler } from './$types';

/** Streams the optional hardware GLB. Signed-in users only; the URL carries `?v=`, so it is cached for a year. */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Sign in required');
	if (!/^[A-Za-z0-9_-]+$/.test(params.id)) error(404, 'Not found');
	const path = templateHardwarePath(params.id);
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
