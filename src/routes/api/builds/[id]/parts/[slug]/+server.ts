import { getDb } from '#lib/server/db/index.ts';
import { updatePart } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		updatePart(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.slug,
			await readJson(event)
		)
	);
