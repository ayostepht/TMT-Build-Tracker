import { ApiError, buildAccess, requireEditor } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { checkPartSlugs } from '#lib/server/printers/jobs.ts';
import { loadBuildView } from '#lib/server/builds/view.ts';
import { setExpected } from '#lib/server/org-settings.ts';
import { getPrinter } from '#lib/server/printers/store.ts';
import type { RequestHandler } from './$types';

/** "Start on this printer": remember which plate the next job from the printer belongs to (12 h). */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const userId = requireUserId(event);
		const p = getPrinter(db, event.params.id);
		if (!p) throw new ApiError(404, 'Not found');
		requireEditor(db, p.organizationId, userId);
		const body = (await readJson(event)) as Record<string, unknown>;
		if (typeof body?.buildId !== 'string' || typeof body.plateNumber !== 'number')
			throw new ApiError(400, 'buildId and plateNumber are required');
		const access = buildAccess(db, body.buildId, userId);
		if (!access || access.organizationId !== p.organizationId)
			throw new ApiError(404, 'Build not found');
		if (access.kind === 'draft') throw new ApiError(400, 'Drafts cannot be linked to print jobs.');
		const view = loadBuildView(db, body.buildId, userId);
		if (!view || !view.plates.some((pl) => pl.number === body.plateNumber))
			throw new ApiError(400, 'Unknown plate');
		const partSlugs = checkPartSlugs(view, body.plateNumber, body.partSlugs);
		setExpected(db, p.organizationId, p.id, {
			buildId: body.buildId,
			plate: body.plateNumber,
			...(partSlugs ? { partSlugs } : {}),
			at: Date.now()
		});
	});
