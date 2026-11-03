import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiError } from '#lib/server/access.ts';
import { respond } from '#lib/server/api.ts';
import { importsDir } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db/index.ts';
import { requireAdminForTemplate } from '#lib/server/models/guard.ts';
import { saveUpload } from '#lib/server/models/uploads.ts';
import { importPrintGeometry, listPrintGeometry } from '#lib/server/print-geometry/import.ts';
import { templateSeeds } from '#lib/server/seed/index.ts';
import { seedTemplates } from '#lib/server/seed/run.ts';
import { clearImportedGeometry } from '#lib/server/print-geometry/store.ts';
import type { RequestHandler } from './$types';

const MAX_BYTES = 200 * 1024 * 1024;

/** Site admin: the template's print geometry rows (seed and imported). */
export const GET: RequestHandler = (event) =>
	respond(() => {
		requireAdminForTemplate(event, event.params.id);
		return { rows: listPrintGeometry(getDb(), event.params.id) };
	});

/**
 * Site admin: upload a profile 3MF (or a zip of 3MFs) as the raw request body, `?name=` for
 * its file name. Parsed while the request waits (about 15 s for the 88 MB TMT profile); the
 * response carries the per-file report. Later uploads replace the parts they contain.
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		requireAdminForTemplate(event, event.params.id);
		const dest = join(importsDir(), `geometry-${randomUUID()}.upload`);
		await saveUpload(event.request, dest, {
			maxBytes: MAX_BYTES,
			magic: 'PK\x03\x04',
			what: '3MF or zip file'
		});
		try {
			const name = (event.url.searchParams.get('name') ?? 'upload.3mf').split(/[\\/]/).pop()!;
			return await importPrintGeometry(getDb(), event.params.id, dest, name);
		} catch (e) {
			if (e instanceof ApiError) throw e;
			throw new ApiError(400, e instanceof Error ? e.message : 'Could not read that file');
		} finally {
			await unlink(dest).catch(() => {});
		}
	});

/** Site admin: forget imported geometry (meshes and rows); the kit's seed footprints come back on the next start. */
export const DELETE: RequestHandler = (event) =>
	respond(() => {
		requireAdminForTemplate(event, event.params.id);
		const removed = clearImportedGeometry(getDb(), event.params.id);
		seedTemplates(getDb(), templateSeeds); // brings the seed footprints back
		return { removed };
	});
