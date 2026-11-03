import { getDb } from '#lib/server/db/index.ts';
import { deleteRun, updateRun } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = (event) =>
	respond(() =>
		deleteRun(getDb(), event.params.id, requireUserId(event), event.params.runId, {
			recompute: event.url.searchParams.get('recompute') !== '0'
		})
	);

export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		updateRun(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.runId,
			await readJson(event)
		)
	);
