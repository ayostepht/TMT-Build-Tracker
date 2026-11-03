import { getDb } from '#lib/server/db/index.ts';
import { undoRun } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	respond(async () =>
		undoRun(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.runId,
			await readJson(event)
		)
	);
