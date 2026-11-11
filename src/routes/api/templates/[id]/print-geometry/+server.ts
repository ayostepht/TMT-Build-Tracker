import { respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { requireAdminForTemplate } from '#lib/server/models/guard.ts';
import { listPrintGeometry } from '#lib/server/print-geometry/import.ts';
import { templateSeeds } from '#lib/server/seed/index.ts';
import { seedTemplates } from '#lib/server/seed/run.ts';
import { uploadPrintGeometry } from '#lib/server/templates/print-geometry-upload.ts';
import { clearImportedGeometry } from '#lib/server/print-geometry/store.ts';
import type { RequestHandler } from './$types';

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
		const name = (event.url.searchParams.get('name') ?? 'upload.3mf').split(/[\\/]/).pop()!;
		return await uploadPrintGeometry(
			getDb(),
			event.locals.user!,
			event.params.id,
			event.request,
			name
		);
	});

/** Site admin: forget imported geometry (meshes and rows); the kit's seed footprints come back on the next start. */
export const DELETE: RequestHandler = (event) =>
	respond(() => {
		requireAdminForTemplate(event, event.params.id);
		const removed = clearImportedGeometry(getDb(), event.params.id);
		seedTemplates(getDb(), templateSeeds); // brings the seed footprints back
		return { removed };
	});
