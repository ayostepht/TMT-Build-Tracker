import { getDb } from '#lib/server/db/index.ts';
import { clearGuide, guideStatus, setGuideMapping } from '#lib/server/guide.ts';
import { requireAdminForTemplate } from '#lib/server/models/guard.ts';
import { readJson, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Site admin: which PDF pages are uploaded and which PDF page each guide page shows. */
export const GET: RequestHandler = (event) =>
	respond(async () => {
		requireAdminForTemplate(event, event.params.id);
		return await guideStatus(getDb(), event.params.id);
	});

/** Site admin: `{ map: { "<guide page>": <pdf page> | null } }` sets which uploaded image each guide page shows. */
export const PUT: RequestHandler = (event) =>
	respond(async () => {
		requireAdminForTemplate(event, event.params.id);
		const body = (await readJson(event)) as { map?: unknown };
		const changed = await setGuideMapping(getDb(), event.params.id, body?.map);
		return { changed };
	});

/** Site admin: remove every imported guide image and mapping. */
export const DELETE: RequestHandler = (event) =>
	respond(async () => {
		requireAdminForTemplate(event, event.params.id);
		await clearGuide(getDb(), event.params.id);
	});
