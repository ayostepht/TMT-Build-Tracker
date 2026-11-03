import { getDb } from '#lib/server/db/index.ts';
import { deleteDesign, getDesignDetail, updateDesignMeta } from '#lib/server/designs/designs.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** `[id]` is the design's id or its slug. */
export const GET: RequestHandler = (event) =>
	respond(async () => ({
		design: await getDesignDetail(getDb(), event.params.id, requireUserId(event))
	}));

/** `{ name?, isPublic? }`: author only. */
export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		updateDesignMeta(getDb(), event.params.id, requireUserId(event), await readJson(event))
	);

export const DELETE: RequestHandler = (event) =>
	respond(() => deleteDesign(getDb(), event.params.id, requireUserId(event)));
