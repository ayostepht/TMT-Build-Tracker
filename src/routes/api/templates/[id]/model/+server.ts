import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { respond } from '#lib/server/api.ts';
import { importsDir } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db/index.ts';
import { requireAdminForTemplate } from '#lib/server/models/guard.ts';
import { createJob, kickQueue } from '#lib/server/models/jobs.ts';
import { saveUpload } from '#lib/server/models/uploads.ts';
import type { RequestHandler } from './$types';

/** STEP zips: the TMT's is about 100 MB. Independent of `MAX_3MF_MB`; `BODY_SIZE_LIMIT` (1100M) is above it. */
const MAX_ZIP_BYTES = 200 * 1024 * 1024;

/**
 * Site admin: upload a STEP zip (the raw zip file as the request body, `?name=` for its
 * file name) and queue its conversion. Streamed to `<uploads>/imports/<jobId>.zip`.
 * Needs `BODY_SIZE_LIMIT` above the zip size (see the README).
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireAdminForTemplate(event, event.params.id);
		const db = getDb();
		const jobKey = randomUUID();
		const dest = join(importsDir(), `${jobKey}.zip`);
		await saveUpload(event.request, dest, {
			maxBytes: MAX_ZIP_BYTES,
			magic: 'PK\x03\x04',
			what: 'zip file'
		});
		try {
			const name = (event.url.searchParams.get('name') ?? 'upload.zip').split(/[\\/]/).pop()!;
			const job = createJob(db, {
				templateId: event.params.id,
				inputPath: dest,
				userId,
				fileName: name
			});
			kickQueue(db);
			return { jobId: job.id };
		} catch (e) {
			await unlink(dest).catch(() => {});
			throw e;
		}
	});
