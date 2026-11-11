/**
 * Receives an uploaded 3MF without holding it in memory: the request body is
 * streamed to `<uploads>/3mf/<id>.3mf`, parsed from disk and deleted again.
 *
 * Only a raw body is accepted (`application/octet-stream` with the file name in `?name=`,
 * what the app's own client sends; with curl use `--data-binary @file.3mf`).
 * `multipart/form-data` is refused with 415 before the body is read, because the runtime
 * would buffer the whole form (up to 1 GB) before any size check.
 *
 * adapter-node refuses request bodies over `BODY_SIZE_LIMIT` (512 kB by default)
 * before any handler runs, so the deployment must raise it. The Dockerfile sets one global `BODY_SIZE_LIMIT=1100M`
 * (shared with the model and print-geometry imports); this module enforces its own per-upload limit
 * (`MAX_3MF_MB`, default 1024: a project sliced with G-code for all plates is several hundred MB),
 * so a larger `BODY_SIZE_LIMIT` is needed to raise it. The body is only ever streamed to disk, and the
 * parser inflates just `Metadata/` configs and thumbnails; `plate_N.gcode` is only stream-scanned afterwards
 * for per-object cost (`gcode-stats.ts`, nothing kept in memory) and `3D/Objects/*` is never read.
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ApiError } from '../access';
import { maxThreeMfBytes, uploadsDir } from '../config';
import { attachGcodeObjectStats } from './gcode-stats';
import { parseThreeMfFile, ThreeMfError } from './index';
import type { ThreeMfSummary } from '#lib/domain/threemf.ts';

export const maxUploadBytes = maxThreeMfBytes;

const tooBig = () =>
	new ApiError(413, `The file is larger than ${Math.round(maxUploadBytes() / 1048576)} MB`);

export interface ReceiveOptions {
	/** Disk guard seam: return false when the server is almost out of space (-> 507). */
	hasRoom?: () => boolean;
}

export async function receiveThreeMf(
	request: Request,
	nameFromQuery: string | null,
	opts: ReceiveOptions = {}
): Promise<{ id: string; fileName: string; size: number; summary: ThreeMfSummary }> {
	const type = request.headers.get('content-type') ?? '';
	if (type.toLowerCase().startsWith('multipart/'))
		throw new ApiError(
			415,
			'Send the 3MF as the raw request body (application/octet-stream), not as a multipart form'
		);
	const limit = maxUploadBytes();
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > limit + 1024 * 1024) throw tooBig();

	if (opts.hasRoom && !opts.hasRoom())
		throw new ApiError(507, 'The server is almost out of disk space');

	const id = randomUUID();
	const dir = join(uploadsDir(), '3mf');
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${id}.3mf`);
	const fileName = (nameFromQuery ?? '').trim();
	let size = 0;
	try {
		const source: ReadableStream<Uint8Array> | null = request.body;
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
			// Per-object time and extrusion from the plates' G-code, while the file is still on disk.
			if (summary.sliced) {
				const rep = await attachGcodeObjectStats(path, summary);
				if (rep.note) summary.warnings.push(rep.note);
			}
		} catch (e) {
			if (e instanceof ThreeMfError) throw new ApiError(422, e.message);
			throw e;
		}
		return { id, fileName: fileName || 'upload.3mf', size, summary };
	} finally {
		rmSync(path, { force: true });
	}
}
