import { ApiError } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { findDesign } from '#lib/server/designs/designs.ts';
import { applyDesignToBuild, previewApplyDesign } from '#lib/server/designs/mutate.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/**
 * `{ buildId, mode?: 'colors' | 'full', confirm?: true, dryRun?: true }`: apply this design to that build
 * (editor or owner of the build).
 *
 * - Build not started: replaces colors and part slots as always (`mode: 'colors'` recolors only).
 * - Build started (a run logged, a part not To print, something printing or a live job): no `mode` gives 409
 *   `{ code: 'build-started', started, summary }`. `colors` changes slot filaments only and answers
 *   `{ changed, skipped, keptStock }`. `full` needs `confirm: true` and is refused (409 `build-started`)
 *   while a plate is printing or a printer job is live.
 * - `dryRun`: writes nothing; answers `{ changes, skipped, keptStock, started, summary, fullBlocked }` for the
 *   "Colors only" mode (what the dialog shows).
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const body = (await readJson(event)) as {
			buildId?: unknown;
			mode?: unknown;
			confirm?: unknown;
			dryRun?: unknown;
		} | null;
		const buildId = body?.buildId;
		if (typeof buildId !== 'string') throw new ApiError(400, 'buildId is required');
		const mode = body?.mode;
		if (mode !== undefined && mode !== 'colors' && mode !== 'full')
			throw new ApiError(400, 'mode must be colors or full');
		const db = getDb();
		const id = findDesign(db, event.params.id, userId).id;
		if (body?.dryRun === true) return previewApplyDesign(db, id, buildId, userId);
		const plan = applyDesignToBuild(db, id, buildId, userId, {
			mode,
			confirm: body?.confirm === true
		});
		return plan
			? { changed: plan.changes.length, skipped: plan.skipped, keptStock: plan.keptStock }
			: {};
	});
