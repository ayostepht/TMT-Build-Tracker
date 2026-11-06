import { getDb } from '#lib/server/db/index.ts';
import { forgetPrintTemplate } from '#lib/server/builds/plates.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Forget what the build learned from a sliced file (the plates stay as they are). */
export const DELETE: RequestHandler = (event) =>
	respond(async () => ({
		removed: forgetPrintTemplate(getDb(), event.params.id, requireUserId(event))
	}));
