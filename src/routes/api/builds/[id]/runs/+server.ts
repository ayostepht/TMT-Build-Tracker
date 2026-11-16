import { getDb } from '#lib/server/db/index.ts';
import { addRun } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { syncRunDeduction } from '#lib/server/spoolman/deduct.ts';
import type { RequestHandler } from './$types';

/**
 * Log a run. A Partial with `split` ({ keptSlugs, keptGrams, lostGrams }) makes two runs; `id` is
 * the printed (kept) one and `ids` lists both. Every run is synced with Spoolman.
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const { runId, runIds } = addRun(
			db,
			event.params.id,
			requireUserId(event),
			await readJson(event)
		);
		const warnings: string[] = [];
		for (const id of runIds) {
			const sp = await syncRunDeduction(db, event.params.id, id);
			if (sp.warning && !warnings.includes(sp.warning)) warnings.push(sp.warning);
		}
		return { id: runId, ids: runIds, spoolmanWarning: warnings[0] };
	});
