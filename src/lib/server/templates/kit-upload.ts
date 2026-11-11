import { eq } from 'drizzle-orm';
import { ApiError, isSiteAdmin, type SiteAdminCandidate } from '../access.ts';
import { diskHasRoom, isPublicMode } from '../config.ts';
import type { Db } from '../db/index.ts';
import { templates } from '../db/schema.ts';
import { assertUploadRoom } from '../quota.ts';

/** The workspace that owns a template copy (null for a built-in kit). */
export function templateOwnerOrg(db: Db, templateId: string): string | null {
	return (
		db.select({ o: templates.ownerOrgId }).from(templates).where(eq(templates.id, templateId)).get()
			?.o ?? null
	);
}

/** 507 when the data volume is below its free-space floor. Call before any file is created. */
export function assertDiskRoom(): void {
	if (!diskHasRoom()) throw new ApiError(507, 'The server is almost out of disk space');
}

/**
 * Pre-stream gate for a kit-file upload, after the upload slot is held: the owning workspace is
 * not already over its upload space (409; built-in kits have no workspace), then the disk floor
 * (507). Same order as the STEP zip route.
 */
export function admitKitUpload(db: Db, userId: string, templateId: string): string | null {
	const orgId = templateOwnerOrg(db, templateId);
	if (orgId) assertUploadRoom(db, orgId, 0, { userId });
	assertDiskRoom();
	return orgId;
}

/** Public mode: print-geometry import (a 3MF parse of up to the upload cap) is for site admins only. */
export function assertPrintGeometryImportAllowed(db: Db, user: SiteAdminCandidate): void {
	if (isPublicMode() && !isSiteAdmin(db, user))
		throw new ApiError(
			403,
			'On this server only site admins can import print geometry. Ask the site admin to import it for you.'
		);
}
