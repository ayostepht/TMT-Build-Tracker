import { getDb } from '#lib/server/db/index.ts';
import { promoteDraft } from '#lib/server/builds/actions.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Studio draft → tracked build (keeps design, variants, printer, plates and files). */
export const POST: RequestHandler = (event) =>
	respond(() => promoteDraft(getDb(), event.params.id, requireUserId(event)));
