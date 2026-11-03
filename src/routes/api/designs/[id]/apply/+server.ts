import { ApiError } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { findDesign } from '#lib/server/designs/designs.ts';
import { applyDesignToBuild } from '#lib/server/designs/mutate.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** `{ buildId }`: replace that build's colors with this design (editor or owner of the build). */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const body = await readJson(event);
		const buildId = (body as { buildId?: unknown } | null)?.buildId;
		if (typeof buildId !== 'string') throw new ApiError(400, 'buildId is required');
		const db = getDb();
		applyDesignToBuild(db, findDesign(db, event.params.id, userId).id, buildId, userId);
	});
