import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiError, type SiteAdminCandidate } from '../access.ts';
import { importsDir, maxThreeMfBytes } from '../config.ts';
import type { Db } from '../db/index.ts';
import { saveUpload } from '../models/uploads.ts';
import { importPrintGeometry } from '../print-geometry/import.ts';
import { clearImportedGeometry } from '../print-geometry/store.ts';
import { QuotaError, acquireUploadSlot, assertUploadRoom } from '../quota.ts';
import { seedTemplates } from '../seed/run.ts';
import { templateSeeds } from '../seed/index.ts';
import { admitKitUpload, assertPrintGeometryImportAllowed } from './kit-upload.ts';

/**
 * Print-geometry upload (caller has already checked the user may manage the template).
 * Order: public-mode admin rule (403), upload slot (429), already over? (409), disk floor (507),
 * then stream. After the import the workspace is re-checked; when the meshes pushed it over, the
 * imported geometry is removed again and the upload refused.
 */
export async function uploadPrintGeometry(
	db: Db,
	user: SiteAdminCandidate & { id: string },
	templateId: string,
	request: Request,
	name: string
) {
	assertPrintGeometryImportAllowed(db, user);
	const release = acquireUploadSlot(db, user);
	try {
		const orgId = admitKitUpload(db, user.id, templateId);
		const dest = join(importsDir(), `geometry-${randomUUID()}.upload`);
		await saveUpload(request, dest, {
			maxBytes: maxThreeMfBytes(),
			magic: 'PK\x03\x04',
			what: '3MF or zip file'
		});
		try {
			const report = await importPrintGeometry(db, templateId, dest, name);
			if (orgId) {
				try {
					assertUploadRoom(db, orgId, 0, { userId: user.id });
				} catch (e) {
					if (e instanceof QuotaError) {
						clearImportedGeometry(db, templateId);
						seedTemplates(db, templateSeeds);
					}
					throw e;
				}
			}
			return report;
		} catch (e) {
			if (e instanceof ApiError) throw e;
			throw new ApiError(400, e instanceof Error ? e.message : 'Could not read that file');
		} finally {
			await unlink(dest).catch(() => {});
		}
	} finally {
		release();
	}
}
