import { getDb } from '#lib/server/db/index.ts';
import { buildArrangement } from '#lib/server/builds/plates.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Stored plate positions, a fresh plan's warnings and whether the plates are stale (any member). */
export const GET: RequestHandler = (event) =>
	respond(() => buildArrangement(getDb(), event.params.id, requireUserId(event)));
