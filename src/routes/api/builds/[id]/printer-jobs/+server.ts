import { ApiError, buildAccess } from '#lib/server/access.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { buildJobs } from '#lib/server/printers/jobs.ts';
import { listPrinters, toPublic } from '#lib/server/printers/store.ts';
import type { RequestHandler } from './$types';

/** Active and awaiting-confirmation printer jobs for a build, plus the team's printers (for "Link to plate" and "Start on printer"). */
export const GET: RequestHandler = (event) =>
	respond(() => {
		const db = getDb();
		const access = buildAccess(db, event.params.id, requireUserId(event));
		if (!access) throw new ApiError(404, 'Not found');
		return {
			organizationId: access.organizationId,
			jobs: buildJobs(db, event.params.id, access.organizationId),
			printers: listPrinters(db, access.organizationId).map(toPublic)
		};
	});
