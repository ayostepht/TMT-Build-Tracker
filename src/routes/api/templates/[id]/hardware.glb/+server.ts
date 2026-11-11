import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { canViewTemplate } from '#lib/server/templates/fork.ts';
import { gzipFile } from '#lib/server/compress.ts';
import { templateHardwarePath } from '#lib/server/config.ts';
import type { RequestHandler } from './$types';

/** Streams the optional hardware GLB. Signed-in users only; the URL carries `?v=`, so it is cached for a year. */
export const GET: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Sign in required');
	if (!/^[A-Za-z0-9_-]+$/.test(params.id)) error(404, 'Not found');
	// Another workspace's kit copy is not readable (404, same as a missing file).
	if (!canViewTemplate(getDb(), locals.user, params.id)) error(404, 'Not found');
	const path = templateHardwarePath(params.id);
	let size: number;
	let mtimeMs: number;
	try {
		const s = await stat(path);
		if (!s.isFile()) error(404, 'Not found');
		size = s.size;
		mtimeMs = s.mtimeMs;
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(404, 'Not found');
	}
	const zipped = await gzipFile(request, path, size, mtimeMs, () => readFile(path));
	if (zipped)
		return new Response(new Uint8Array(zipped), {
			headers: {
				'content-type': 'model/gltf-binary',
				'content-encoding': 'gzip',
				'content-length': String(zipped.length),
				'x-file-size': String(size),
				vary: 'Accept-Encoding',
				'cache-control': 'private, max-age=31536000, immutable'
			}
		});
	return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
		headers: {
			'content-type': 'model/gltf-binary',
			'content-length': String(size),
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
