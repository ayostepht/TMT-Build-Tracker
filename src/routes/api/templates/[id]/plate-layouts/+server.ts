import { getDb } from '#lib/server/db/index.ts';
import { listLayouts } from '#lib/server/builds/plates.ts';
import { assertTemplateViewable } from '#lib/server/templates/fork.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Built-in plate layouts of a template (templates are visible to every signed-in user). */
export const GET: RequestHandler = (event) =>
	respond(() => {
		requireUserId(event);
		assertTemplateViewable(getDb(), event.locals.user!, event.params.id);
		return { layouts: listLayouts(getDb(), event.params.id) };
	});
