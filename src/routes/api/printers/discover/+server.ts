import { ApiError, requireEditor } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { discoverSdcp } from '#lib/server/printers/discovery.ts';
import type { RequestHandler } from './$types';

/** SDCP discovery: UDP broadcast "M99999" on port 3000. Only reaches printers on the server's own network segment. */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const body = (await readJson(event)) as Record<string, unknown>;
		const org = typeof body?.organizationId === 'string' ? body.organizationId : '';
		if (!org) throw new ApiError(400, 'organizationId is required');
		requireEditor(getDb(), org, userId);
		const found = await discoverSdcp({ timeoutMs: 3000 });
		return { found };
	});
