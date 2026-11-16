import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { setCurrentSpool } from '#lib/server/spoolman/link.ts';
import type { RequestHandler } from './$types';

/** Set (or clear with null) the spool of the linked filament that deductions start on (`{ spoolId }`). Editors. */
export const PUT: RequestHandler = (event) =>
	respond(async () =>
		setCurrentSpool(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.role,
			await readJson(event)
		)
	);
