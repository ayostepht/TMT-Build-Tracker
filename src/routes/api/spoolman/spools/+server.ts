import { ApiError, requireMember } from '#lib/server/access.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { getOrgSettings } from '#lib/server/org-settings.ts';
import { SpoolmanClient, SpoolmanError } from '#lib/server/spoolman/client.ts';
import type { RequestHandler } from './$types';

/** Spools from the team's Spoolman (server-side call; the browser never talks to Spoolman). */
export const GET: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const org = event.url.searchParams.get('org');
		if (!org) throw new ApiError(400, 'org is required');
		requireMember(db, org, requireUserId(event));
		const url = getOrgSettings(db, org).spoolmanUrl;
		if (!url) return { configured: false, spools: [] };
		try {
			return { configured: true, spools: await new SpoolmanClient(url).listSpools() };
		} catch (e) {
			throw new ApiError(
				e instanceof SpoolmanError ? e.status : 502,
				e instanceof Error ? e.message : 'Spoolman failed'
			);
		}
	});
