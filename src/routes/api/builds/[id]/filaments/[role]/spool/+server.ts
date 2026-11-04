import { getDb } from '#lib/server/db/index.ts';
import { linkSpool } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Link a build filament slot to a Spoolman spool (`{ spoolId }`, or null to unlink). Editors. */
export const PUT: RequestHandler = (event) =>
	respond(async () => {
		linkSpool(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.role,
			await readJson(event)
		);
	});
