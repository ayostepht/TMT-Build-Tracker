import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { ApiError, isSiteAdmin, type SiteAdminCandidate } from '../access.ts';
import { isPublicMode } from '../config.ts';
import { requireUserId } from '../api.ts';
import { getDb, type Db } from '../db/index.ts';
import { templates } from '../db/schema.ts';
import { canManageTemplate } from '../templates/fork.ts';

/**
 * Who may change a template's kit files (404 for everyone else, and for a missing template):
 * site admins for the global kits, owners and editors of the owning workspace for a workspace's
 * own copy (made from "Upload your own files" in the setup wizard).
 */
export function assertTemplateAdmin(db: Db, user: SiteAdminCandidate, templateId: string): void {
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

/**
 * Converting a STEP zip to a 3D model runs OpenCascade in a child process with a large memory
 * budget. On a public server (`TMT_MODE=public`) only site admins may start one (403 with a plain
 * message for everyone else); a self-hosted server keeps letting workspace editors convert their
 * own kit copies. Kit copies and print-geometry imports do not use the converter.
 */
export function assertModelConversionAllowed(db: Db, user: SiteAdminCandidate): void {
	if (isPublicMode() && !isSiteAdmin(db, user))
		throw new ApiError(403, 'Only site admins can convert 3D models on this server.');
}
