/**
 * Receives an uploaded 3MF without holding it in memory: the request body is
 * streamed to `<uploads>/3mf/<id>.3mf`, parsed from disk and deleted again.
 *
 * Two body shapes are accepted: a raw body (`application/octet-stream` with the
 * file name in `?name=`, what the app's own client sends, so progress events and
 * 1 GB files work) and `multipart/form-data` with a `file` field (convenient
 * for curl; the runtime buffers that one, so prefer the raw form for big files).
 *
 * adapter-node refuses request bodies over `BODY_SIZE_LIMIT` (512 kB by default)
 * before any handler runs, so the deployment must raise it. The Dockerfile sets one global `BODY_SIZE_LIMIT=1100M`
 * (shared with the model and print-geometry imports); this module enforces its own per-upload limit
 * (`MAX_3MF_MB`, default 1024: a project sliced with G-code for all plates is several hundred MB),
 * so a larger `BODY_SIZE_LIMIT` is needed to raise it. The body is only ever streamed to disk, and the
 * parser inflates just `Metadata/` configs and thumbnails (never `plate_N.gcode` or `3D/Objects/*`).
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ApiError } from '../access';
import { maxThreeMfBytes, uploadsDir } from '../config';
import { parseThreeMfFile, ThreeMfError } from './index';
import type { ThreeMfSummary } from '#lib/domain/threemf.ts';

export const maxUploadBytes = maxThreeMfBytes;

const tooBig = () =>
	new ApiError(413, `The file is larger than ${Math.round(maxUploadBytes() / 1048576)} MB`);

export async function receiveThreeMf(
	request: Request,
	nameFromQuery: string | null
): Promise<{ id: string; fileName: string; size: number; summary: ThreeMfSummary }> {
	const limit = maxUploadBytes();
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > limit + 1024 * 1024) throw tooBig();

	const id = randomUUID();
	const dir = join(uploadsDir(), '3mf');
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${id}.3mf`);
	let fileName = (nameFromQuery ?? '').trim();
	let size = 0;
	try {
		const type = request.headers.get('content-type') ?? '';
		let source: ReadableStream<Uint8Array> | null;
		if (type.startsWith('multipart/form-data')) {
			const form = await request.formData();
			const f = form.get('file');
			if (!(f instanceof File)) throw new ApiError(400, 'Attach the 3MF as the "file" field');
			if (f.size > limit) throw tooBig();
			fileName ||= f.name;
			source = f.stream() as ReadableStream<Uint8Array>;
		} else {
			source = request.body;
		}
		if (!source) throw new ApiError(400, 'Empty upload');
		const counter = new Transform({
			transform(chunk: Buffer, _enc, cb) {
				size += chunk.length;
				if (size > limit) cb(tooBig());
				else cb(null, chunk);
			}
		});
		await pipeline(Readable.fromWeb(source as never), counter, createWriteStream(path));
		if (size === 0) throw new ApiError(400, 'Empty upload');
		let summary: ThreeMfSummary;
		try {
			summary = await parseThreeMfFile(path);
		} catch (e) {
			if (e instanceof ThreeMfError) throw new ApiError(422, e.message);
			throw e;
		}
		return { id, fileName: fileName || 'upload.3mf', size, summary };
	} finally {
		rmSync(path, { force: true });
	}
}
