import { ApiError, requireEditor, requireMember } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { teamJobs } from '#lib/server/printers/jobs.ts';
import { createPrinter, listPrinters, toPublic } from '#lib/server/printers/store.ts';
import { getSupervisor } from '#lib/server/printers/supervisor.ts';
import { getOrgSettings } from '#lib/server/org-settings.ts';
import type { RequestHandler } from './$types';

/** Printers of a team with their last known status (members). Secrets are never included. */
export const GET: RequestHandler = (event) =>
	respond(() => {
		const db = getDb();
		const userId = requireUserId(event);
		const org = event.url.searchParams.get('org');
		if (!org) throw new ApiError(400, 'org is required');
		const role = requireMember(db, org, userId);
		return {
			canEdit: role !== 'viewer',
			printers: listPrinters(db, org).map(toPublic),
			jobs: teamJobs(db, org),
			autoLogPrints: getOrgSettings(db, org).autoLogPrints
		};
	});

export const POST: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const userId = requireUserId(event);
		const body = (await readJson(event)) as Record<string, unknown>;
		const org = typeof body?.organizationId === 'string' ? body.organizationId : '';
		if (!org) throw new ApiError(400, 'organizationId is required');
		requireEditor(db, org, userId);
		const row = createPrinter(db, org, userId, body);
		getSupervisor()?.refresh(row.id);
		return { printer: toPublic(row) };
	});
