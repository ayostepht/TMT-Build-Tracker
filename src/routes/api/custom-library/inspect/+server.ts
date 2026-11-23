import { getDb } from '#lib/server/db/index.ts';
import { ApiError, requireEditor } from '#lib/server/access.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import { importsDir } from '#lib/server/config.ts';
import { inspectSummary } from '#lib/server/custom-library.ts';
import { guardedReceiveThreeMf } from '#lib/server/threemf/upload-guard.ts';
import type { RequestHandler } from './$types';

/**
 * `?organizationId=…&name=<file name>` with the raw 3MF as the body (octet-stream, like the build upload):
 * read the file for the "add a saved part" form and answer a summary only (slots, plates, time, grams).
 * Nothing is stored; the temp file (`<uploads>/imports/<uuid>.zip`, a name `sweepImportsDir` also clears
 * after a crash) is deleted before the answer, on every path. Editors of the workspace, checked before
 * the body is read.
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const userId = requireUserId(event);
		const org = event.url.searchParams.get('organizationId');
		if (!org) throw new ApiError(400, 'organizationId is required');
		requireEditor(db, org, userId);
		return guardedReceiveThreeMf(
			db,
			{
				user: event.locals.user!,
				userId,
				organizationId: org,
				request: event.request,
				name: event.url.searchParams.get('name'),
				receive: { tempDir: importsDir(), tempExt: '.zip' }
			},
			(up) => inspectSummary(up.fileName, up.summary)
		);
	});
