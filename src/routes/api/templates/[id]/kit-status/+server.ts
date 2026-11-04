import { eq } from 'drizzle-orm';
import { ApiError, isSiteAdmin } from '#lib/server/access.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { templates } from '#lib/server/db/schema.ts';
import { kitStatus } from '#lib/server/kit-status.ts';
import type { RequestHandler } from './$types';

/**
 * Any signed-in user: what the install holds for this kit (the checklist) and whether they may
 * add files (`canImport`: site admins only, imports are install-wide).
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
		return { status: await kitStatus(db, t.id), canImport: isSiteAdmin(db, event.locals.user!) };
	});
