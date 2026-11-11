import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiError } from '#lib/server/access.ts';
import { respond } from '#lib/server/api.ts';
import { diskHasRoom, importsDir } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db/index.ts';
import { templates } from '#lib/server/db/schema.ts';
import { acquireUploadSlot, assertUploadRoom } from '#lib/server/quota.ts';
import { eq } from 'drizzle-orm';
import { requireAdminForTemplate } from '#lib/server/models/guard.ts';
import { assertConversionSlot, createJob, kickQueue } from '#lib/server/models/jobs.ts';
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
		// Order: upload slot (429), conversion slot (409), already over the upload space (409),
		// disk guard (507), then stream. All refusals come before any file is created.
		const release = acquireUploadSlot(db, event.locals.user!);
		try {
			assertConversionSlot(db, userId);
			// Kit files of a workspace's own copy count toward that workspace; global kits have no owner.
			const orgId =
				db
					.select({ o: templates.ownerOrgId })
					.from(templates)
					.where(eq(templates.id, event.params.id))
					.get()?.o ?? null;
			if (orgId) assertUploadRoom(db, orgId, 0, { userId });
			if (!diskHasRoom()) throw new ApiError(507, 'The server is almost out of disk space');
			const jobKey = randomUUID();
			const dest = join(importsDir(), `${jobKey}.zip`);
			await saveUpload(event.request, dest, {
				maxBytes: MAX_ZIP_BYTES,
				magic: 'PK\x03\x04',
				what: 'zip file'
			});
			try {
				// The zip is temporary (deleted once converted; only the GLB stays), so it does not count
				// itself. Re-check "already over?" now that the stream is done: parallel uploads or
				// growth while this one streamed are caught before a job is queued.
				if (orgId) assertUploadRoom(db, orgId, 0, { userId });
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
		} finally {
			release();
		}
	});
