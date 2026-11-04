import { ApiError } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { chooseBuildTemplate } from '#lib/server/templates/fork.ts';
import { emitBuildEvent } from '#lib/server/events.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/**
 * Setup wizard, step 1: `{ own: boolean }`. `own: true` points the build at a workspace-owned copy
 * of its template (created on first use) so the user can add their own files; `false` goes back
 * to the built-in kit. Returns the template id the build now uses.
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const b = await readJson(event);
		if (typeof b !== 'object' || b === null || typeof (b as { own?: unknown }).own !== 'boolean')
			throw new ApiError(400, 'own (boolean) is required');
		const out = chooseBuildTemplate(getDb(), event.params.id, userId, (b as { own: boolean }).own);
		emitBuildEvent(event.params.id, {
			type: 'changed',
			kind: 'build.template',
			by: null,
			at: new Date().toISOString()
		});
		return out;
	});
