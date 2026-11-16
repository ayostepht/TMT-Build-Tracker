import { getDb } from '#lib/server/db/index.ts';
import { undoRun } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { syncRunDeduction } from '#lib/server/spoolman/deduct.ts';
import type { RequestHandler } from './$types';

/** Undo a just-logged run (`{ parts, runIds? }`); `runIds` names both runs of a split Partial. */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const removed = undoRun(
			db,
			event.params.id,
			requireUserId(event),
			event.params.runId,
			await readJson(event)
		);
		let warning: string | undefined;
		for (const id of removed) {
			const sp = await syncRunDeduction(db, event.params.id, id);
			warning ??= sp.warning;
		}
		return { spoolmanWarning: warning };
	});
