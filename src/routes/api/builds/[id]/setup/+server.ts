import { getDb } from '#lib/server/db/index.ts';
import { setSetupStep } from '#lib/server/builds/actions.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Setup wizard progress: `{ step: 1..5 | null }` (null = finished). */
export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		setSetupStep(getDb(), event.params.id, requireUserId(event), await readJson(event))
	);
