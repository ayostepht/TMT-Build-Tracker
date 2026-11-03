import { respond, readJson } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { requireAdminForTemplate } from '#lib/server/models/guard.ts';
import { applyPlacementPatch, parsePlacementPatch } from '#lib/server/models/placements.ts';
import type { RequestHandler } from './$types';

/** Site admin: change where a part sits in the 3D model. Body `{ matrix?, instances?, placed? }`. */
export const PATCH: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireAdminForTemplate(event, event.params.id);
		const patch = parsePlacementPatch(await readJson(event));
		return {
			placement: applyPlacementPatch(getDb(), event.params.id, event.params.slug, patch, userId)
		};
	});
