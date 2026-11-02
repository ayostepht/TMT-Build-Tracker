import { getDb } from '#lib/server/db/index.ts';
import { updateFilament } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		updateFilament(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.role,
			await readJson(event)
		)
	);
