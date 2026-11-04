import { getDb } from '#lib/server/db/index.ts';
import { deleteBuild, updateBuild } from '#lib/server/builds/actions.ts';
import { removeBuildPhotoFiles } from '#lib/server/builds/photos.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		updateBuild(getDb(), event.params.id, requireUserId(event), await readJson(event))
	);

export const DELETE: RequestHandler = (event) =>
	respond(async () => {
		deleteBuild(getDb(), event.params.id, requireUserId(event));
		await removeBuildPhotoFiles(event.params.id);
	});
