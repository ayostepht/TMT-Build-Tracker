import { ApiError, requireEditor, requireMember } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { pendingExpected, teamJobs } from '#lib/server/printers/jobs.ts';
import { createPrinter, listPrinters, toPublic } from '#lib/server/printers/store.ts';
import { getSupervisor } from '#lib/server/printers/supervisor.ts';
import { and, eq } from 'drizzle-orm';
import { builds } from '#lib/server/db/schema.ts';
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
		const editor = role !== 'viewer';
		return {
			canEdit: editor,
			// Editors only: the builds a running job can be linked to, and plates sent to a printer
			// that now runs an unlinked job (the Printers page asks "Confirm ...?" for those).
			builds: editor
				? db
						.select({ id: builds.id, name: builds.name })
						.from(builds)
						.where(and(eq(builds.organizationId, org), eq(builds.kind, 'build')))
						.orderBy(builds.name)
						.all()
				: [],
			expected: editor ? pendingExpected(db, org) : [],
			printers: listPrinters(db, org).map((p) => toPublic(p, role !== 'viewer')),
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
		return { printer: toPublic(row, true) };
	});
