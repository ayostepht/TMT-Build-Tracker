import { ApiError, requireMember, requireOwner } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { getOrgSettings, setOrgSettings } from '#lib/server/org-settings.ts';
import { normalizeSpoolmanUrl, SpoolmanError } from '#lib/server/spoolman/client.ts';
import type { RequestHandler } from './$types';

/** Team integration settings: Spoolman address, auto-deduct, auto-log finished prints. */
export const GET: RequestHandler = (event) =>
	respond(() => {
		const db = getDb();
		const org = event.url.searchParams.get('org');
		if (!org) throw new ApiError(400, 'org is required');
		const role = requireMember(db, org, requireUserId(event));
		return { settings: getOrgSettings(db, org), canEdit: role === 'owner' };
	});

export const PUT: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const userId = requireUserId(event);
		const body = (await readJson(event)) as Record<string, unknown>;
		const org = typeof body?.organizationId === 'string' ? body.organizationId : '';
		if (!org) throw new ApiError(400, 'organizationId is required');
		requireOwner(db, org, userId);
		const patch: Parameters<typeof setOrgSettings>[2] = {};
		if (body.spoolmanUrl !== undefined) {
			if (body.spoolmanUrl === null || body.spoolmanUrl === '') patch.spoolmanUrl = null;
			else if (typeof body.spoolmanUrl !== 'string')
				throw new ApiError(400, 'spoolmanUrl must be text');
			else {
				try {
					patch.spoolmanUrl = normalizeSpoolmanUrl(body.spoolmanUrl);
				} catch (e) {
					throw new ApiError(400, e instanceof SpoolmanError ? e.message : 'Invalid address');
				}
			}
		}
		for (const k of ['spoolmanAutoDeduct', 'autoLogPrints'] as const) {
			if (body[k] === undefined) continue;
			if (typeof body[k] !== 'boolean') throw new ApiError(400, `${k} must be true or false`);
			patch[k] = body[k] as boolean;
		}
		setOrgSettings(db, org, patch);
		return { settings: getOrgSettings(db, org) };
	});
