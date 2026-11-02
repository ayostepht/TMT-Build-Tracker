import { getDb } from '#lib/server/db/index.ts';
import { deleteRun } from '#lib/server/builds/actions.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = (event) =>
	respond(() => deleteRun(getDb(), event.params.id, requireUserId(event), event.params.runId));
