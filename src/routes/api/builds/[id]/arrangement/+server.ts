import { getDb } from '#lib/server/db/index.ts';
import { buildArrangement } from '#lib/server/builds/plates.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import { acquireExpensiveReadSlot } from '#lib/server/quota.ts';
import type { RequestHandler } from './$types';

/** Stored plate positions, a fresh plan's warnings and whether the plates are stale (any member). */
export const GET: RequestHandler = (event) =>
	respond(() => {
		const userId = requireUserId(event);
		const release = acquireExpensiveReadSlot(getDb(), event.locals.user!, Date.now(), {
			light: true
		});
		try {
			return buildArrangement(getDb(), event.params.id, userId);
		} finally {
			release();
		}
	});
