import { getDb } from '#lib/server/db/index.ts';
import { deleteRun, updateRun } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { syncRunDeduction } from '#lib/server/spoolman/deduct.ts';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		deleteRun(db, event.params.id, requireUserId(event), event.params.runId, {
			recompute: event.url.searchParams.get('recompute') !== '0'
		});
		// The run row is gone, so this puts its grams back on the spools.
		return {
			spoolmanWarning: (await syncRunDeduction(db, event.params.id, event.params.runId)).warning
		};
	});

export const PATCH: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		updateRun(db, event.params.id, requireUserId(event), event.params.runId, await readJson(event));
		return {
			spoolmanWarning: (await syncRunDeduction(db, event.params.id, event.params.runId)).warning
		};
	});
