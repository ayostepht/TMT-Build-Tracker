import { getDb } from '#lib/server/db/index.ts';
import { skipParts } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** `{ slugs: string[], skip: boolean }`: mark parts "Not printing", or bring them back (editor or owner). */
export const POST: RequestHandler = (event) =>
	respond(async () =>
		skipParts(getDb(), event.params.id, requireUserId(event), await readJson(event))
	);
