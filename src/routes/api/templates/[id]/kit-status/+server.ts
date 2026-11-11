import { eq } from 'drizzle-orm';
import { ApiError } from '#lib/server/access.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { templates } from '#lib/server/db/schema.ts';
import { kitStatus } from '#lib/server/kit-status.ts';
import { assertTemplateViewable, canManageTemplate } from '#lib/server/templates/fork.ts';
import type { RequestHandler } from './$types';

/**
 * Any signed-in user: what the install holds for this kit (the checklist) and whether they may
 * add files (`canImport`: site admins for the built-in kit, owners and editors for a workspace's own copy).
 */
export const GET: RequestHandler = (event) =>
	respond(async () => {
		requireUserId(event);
		const db = getDb();
		const t = db
			.select({ id: templates.id })
			.from(templates)
			.where(eq(templates.id, event.params.id))
			.get();
		if (!t) throw new ApiError(404, 'Not found');
		assertTemplateViewable(db, event.locals.user!, t.id);
		return {
			status: await kitStatus(db, t.id),
			canImport: canManageTemplate(db, event.locals.user!, t.id)
		};
	});
