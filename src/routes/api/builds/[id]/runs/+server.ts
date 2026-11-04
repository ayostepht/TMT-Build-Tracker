import { getDb } from '#lib/server/db/index.ts';
import { addRun } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { syncRunDeduction } from '#lib/server/spoolman/deduct.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const id = addRun(db, event.params.id, requireUserId(event), await readJson(event));
		const sp = await syncRunDeduction(db, event.params.id, id);
		return { id, spoolmanWarning: sp.warning };
	});
