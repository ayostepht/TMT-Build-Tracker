import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { addSpoolmanSpool } from '#lib/server/spoolman/create.ts';
import type { RequestHandler } from './$types';

/** Add a spool of the linked filament in Spoolman: `{ kg, note? }` -> `{ id, spoolmanSpoolId, current }`. Editors. */
export const POST: RequestHandler = (event) =>
	respond(async () =>
		addSpoolmanSpool(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.role,
			await readJson(event)
		)
	);
