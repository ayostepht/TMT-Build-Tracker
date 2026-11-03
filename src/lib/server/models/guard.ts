import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { ApiError, requireSiteAdmin } from '../access.ts';
import { requireUserId } from '../api.ts';
import { getDb, type Db } from '../db/index.ts';
import { templates } from '../db/schema.ts';

/** Site admin (404 for everyone else) and an existing template (404). */
export function assertTemplateAdmin(
	db: Db,
	user: { id: string; email?: string | null },
	templateId: string
): void {
	requireSiteAdmin(db, user);
	const t = db
		.select({ id: templates.id })
		.from(templates)
		.where(eq(templates.id, templateId))
		.get();
	if (!t) throw new ApiError(404, 'Not found');
}

/** Request-handler version: 401 when signed out. Returns the user id. */
export function requireAdminForTemplate(event: RequestEvent, templateId: string): string {
	const userId = requireUserId(event);
	assertTemplateAdmin(getDb(), event.locals.user!, templateId);
	return userId;
}
