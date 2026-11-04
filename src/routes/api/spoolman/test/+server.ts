import { ApiError, requireOwner } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { getOrgSettings } from '#lib/server/org-settings.ts';
import { SpoolmanClient, SpoolmanError } from '#lib/server/spoolman/client.ts';
import type { RequestHandler } from './$types';

/** Check a Spoolman address (the typed one, else the saved one). */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const userId = requireUserId(event);
		const body = (await readJson(event)) as Record<string, unknown>;
		const org = typeof body?.organizationId === 'string' ? body.organizationId : '';
		if (!org) throw new ApiError(400, 'organizationId is required');
		requireOwner(db, org, userId);
		const url =
			(typeof body.spoolmanUrl === 'string' && body.spoolmanUrl) ||
			getOrgSettings(db, org).spoolmanUrl;
		if (!url) throw new ApiError(400, 'Enter the Spoolman address first');
		try {
			const c = new SpoolmanClient(url);
			const h = await c.health();
			const spools = await c.listSpools();
			return { version: h.version, spoolCount: spools.length };
		} catch (e) {
			throw new ApiError(
				e instanceof SpoolmanError ? e.status : 502,
				e instanceof Error ? e.message : 'Failed'
			);
		}
	});
