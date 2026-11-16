import { getDb } from '#lib/server/db/index.ts';
import { addSpool } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Add a spool to a color's stock: `{ kg, note? }` -> `{ id }`. Editors and owners; not for drafts. */
export const POST: RequestHandler = (event) =>
	respond(async () => ({
		id: addSpool(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.role,
			await readJson(event)
		)
	}));
