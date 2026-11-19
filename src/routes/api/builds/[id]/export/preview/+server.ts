import { getDb } from '#lib/server/db/index.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import { acquireExpensiveReadSlot } from '#lib/server/quota.ts';
import { parseFlavor, parsePlates, previewExport } from '#lib/server/threemf-export/index.ts';
import type { RequestHandler } from './$types';

/** What the export would contain: plates, objects, filament slots, warnings (any member). */
export const GET: RequestHandler = (event) =>
	respond(() => {
		const userId = requireUserId(event);
		const release = acquireExpensiveReadSlot(getDb(), event.locals.user!, Date.now(), {
			light: true
		});
		try {
			const q = event.url.searchParams;
			return previewExport(getDb(), event.params.id, userId, {
				flavor: parseFlavor(q.get('flavor')),
				plates: parsePlates(q.get('plates'))
			});
		} finally {
			release();
		}
	});
