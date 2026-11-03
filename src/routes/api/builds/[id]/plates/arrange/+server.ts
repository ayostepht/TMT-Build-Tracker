import { getDb } from '#lib/server/db/index.ts';
import { arrangeForPrinter } from '#lib/server/builds/plates.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** `{ convertRuns? }`: arrange the build's plates for its printer (editor or owner). */
export const POST: RequestHandler = (event) =>
	respond(async () =>
		arrangeForPrinter(getDb(), event.params.id, requireUserId(event), await readJson(event))
	);
