import { requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { applyPrelinkDeduction, undoPrelinkDeduction } from '#lib/server/spoolman/link.ts';
import type { RequestHandler } from './$types';

/** Subtract the grams logged before the link from Spoolman, once. Editors. */
export const POST: RequestHandler = (event) =>
	respond(() =>
		applyPrelinkDeduction(getDb(), event.params.id, requireUserId(event), event.params.role)
	);

/** Give those grams back. Editors. */
export const DELETE: RequestHandler = (event) =>
	respond(() =>
		undoPrelinkDeduction(getDb(), event.params.id, requireUserId(event), event.params.role)
	);
