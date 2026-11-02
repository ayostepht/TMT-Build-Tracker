import { getDb } from '#lib/server/db/index.ts';
import { setPartStatus } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	respond(async () =>
		setPartStatus(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.slug,
			await readJson(event)
		)
	);
