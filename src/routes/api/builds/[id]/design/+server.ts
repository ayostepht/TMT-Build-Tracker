import { getDb } from '#lib/server/db/index.ts';
import { updateBuildDesign } from '#lib/server/designs/mutate.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/**
 * `{ partRoles?: { slug: roleKey }, addRole?: { key?, name, material, hex }, removeRole?: key }`:
 * edit the build's colors (editor or owner).
 */
export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		updateBuildDesign(getDb(), event.params.id, requireUserId(event), await readJson(event))
	);
