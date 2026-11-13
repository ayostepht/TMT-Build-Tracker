import { getDb } from '#lib/server/db/index.ts';
import { updateBuildDesign } from '#lib/server/designs/mutate.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/**
 * Edit the build's colors (editor or owner; builds and Studio drafts), one transaction, one activity row:
 * `{ partRoles?: { slug: roleKey }, addRole?: { key?, name, material, hex },
 *    palette?: { label, slots: { roleKey: { name, material, hex } }, reset?: true },
 *    lock?: { slugs: string[], locked: boolean },
 *    removeRole?: key, replaceWith?: key, removeRoles?: key[] }`.
 * `palette` with `reset` also sends unlocked parts back to their kit slot and keeps locked parts on their
 * old filament (a slot that holds it is reused or added). A used slot is removed with `removeRole` +
 * `replaceWith` (409 without it, 400 for kit slots or when a part cannot use the replacement);
 * `removeRoles` drops slots nothing uses (Undo of an automatically added slot).
 */
export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		updateBuildDesign(getDb(), event.params.id, requireUserId(event), await readJson(event))
	);
