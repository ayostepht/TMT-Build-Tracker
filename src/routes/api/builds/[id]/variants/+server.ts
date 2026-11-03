import { getDb } from '#lib/server/db/index.ts';
import { setVariant } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** `{ group, option }`: choose a variant option for the build (editor or owner). */
export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		setVariant(getDb(), event.params.id, requireUserId(event), await readJson(event))
	);
