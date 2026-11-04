import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { ApiError } from '../access.ts';
import { requireUserId } from '../api.ts';
import { getDb, type Db } from '../db/index.ts';
import { templates } from '../db/schema.ts';
import { canManageTemplate } from '../templates/fork.ts';

/**
 * Who may change a template's kit files (404 for everyone else, and for a missing template):
 * site admins for the global kits, owners and editors of the owning workspace for a workspace's
 * own copy (made from "Upload your own files" in the setup wizard).
 */
export function assertTemplateAdmin(
	db: Db,
	user: { id: string; email?: string | null },
	templateId: string
): void {
	const t = db
		.select({ id: templates.id })
		.from(templates)
		.where(eq(templates.id, templateId))
		.get();
	if (!t || !canManageTemplate(db, user, templateId)) throw new ApiError(404, 'Not found');
}

/** Request-handler version: 401 when signed out. Returns the user id. */
export function requireAdminForTemplate(event: RequestEvent, templateId: string): string {
	const userId = requireUserId(event);
	assertTemplateAdmin(getDb(), event.locals.user!, templateId);
	return userId;
}
