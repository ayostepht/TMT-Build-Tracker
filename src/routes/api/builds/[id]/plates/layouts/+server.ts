import { getDb } from '#lib/server/db/index.ts';
import { buildLayouts } from '#lib/server/builds/plates.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	respond(() => buildLayouts(getDb(), event.params.id, requireUserId(event)));
