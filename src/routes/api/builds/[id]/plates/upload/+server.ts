import { getDb } from '#lib/server/db/index.ts';
import { ApiError, buildAccess } from '#lib/server/access.ts';
import { createUpload } from '#lib/server/builds/plates.ts';
import { loadBuildView } from '#lib/server/builds/view.ts';
import { guardedReceiveThreeMf } from '#lib/server/threemf/upload-guard.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const userId = requireUserId(event);
		const access = buildAccess(db, event.params.id, userId);
		if (!access) throw new ApiError(404, 'Not found');
		if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
		// Slot first (429), then "already over the upload space?" (409), then the disk guard (507) inside receive.
		return guardedReceiveThreeMf(
			db,
			{
				user: event.locals.user!,
				userId,
				organizationId: access.organizationId,
				request: event.request,
				name: event.url.searchParams.get('name')
			},
			(up) => {
				const view = loadBuildView(db, event.params.id, userId);
				if (!view) throw new ApiError(404, 'Not found');
				return createUpload(
					db,
					event.params.id,
					userId,
					{ name: up.fileName, size: up.size },
					up.summary,
					view
				);
			}
		);
	});
