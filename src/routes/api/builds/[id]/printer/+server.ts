import { getDb } from '#lib/server/db/index.ts';
import { setPrinter } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** `{ printer: BuildPrinter | null }`: set or clear the build's printer (editor or owner). */
export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		setPrinter(getDb(), event.params.id, requireUserId(event), await readJson(event))
	);
