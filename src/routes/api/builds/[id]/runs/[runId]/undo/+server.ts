import { getDb } from '#lib/server/db/index.ts';
import { undoRun } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { syncRunDeduction } from '#lib/server/spoolman/deduct.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		undoRun(db, event.params.id, requireUserId(event), event.params.runId, await readJson(event));
		return {
			spoolmanWarning: (await syncRunDeduction(db, event.params.id, event.params.runId)).warning
		};
	});
