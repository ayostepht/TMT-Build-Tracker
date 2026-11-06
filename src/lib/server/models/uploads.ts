import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ApiError } from '../access.ts';

/**
 * Streams a request body straight to `destPath` (via `<destPath>.part` + rename) without
 * buffering it in memory, refusing anything over `maxBytes` or whose first bytes are not `magic`.
 * The body is the raw file (not multipart): `request.formData()` would hold the whole upload in RAM.
 */
export async function saveUpload(
	request: Request,
	destPath: string,
	opts: { maxBytes: number; magic: string; what: string }
): Promise<number> {
	if (!request.body) throw new ApiError(400, `Send the ${opts.what} as the request body`);
	const declared = Number(request.headers.get('content-length') ?? '');
	if (Number.isFinite(declared) && declared > opts.maxBytes)
		throw new ApiError(
			413,
			`The ${opts.what} is larger than ${Math.round(opts.maxBytes / 1048576)} MB`
		);
	await mkdir(dirname(destPath), { recursive: true });
	const tmp = `${destPath}.part`;
	let bytes = 0;
	const limit = new Transform({
		transform(chunk: Buffer, _enc, cb) {
			bytes += chunk.length;
			if (bytes > opts.maxBytes)
				cb(
					new ApiError(
						413,
						`The ${opts.what} is larger than ${Math.round(opts.maxBytes / 1048576)} MB`
					)
				);
			else cb(null, chunk);
		}
	});
	try {
		await pipeline(
			Readable.fromWeb(request.body as import('node:stream/web').ReadableStream),
			limit,
			createWriteStream(tmp)
		);
		const fh = await open(tmp, 'r');
		const head = Buffer.alloc(opts.magic.length);
		await fh.read(head, 0, head.length, 0);
		await fh.close();
		if (bytes === 0 || head.toString('latin1') !== opts.magic)
			throw new ApiError(400, `That is not a valid ${opts.what}`);
		await rename(tmp, destPath);
		return bytes;
	} catch (e) {
		await unlink(tmp).catch(() => {});
		if (e instanceof ApiError) throw e;
		throw new ApiError(400, `The upload failed (${e instanceof Error ? e.message : 'error'})`);
	}
}
