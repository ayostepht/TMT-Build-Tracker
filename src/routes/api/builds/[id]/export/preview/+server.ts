import { getDb } from '#lib/server/db/index.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import { parseFlavor, parsePlates, previewExport } from '#lib/server/threemf-export/index.ts';
import type { RequestHandler } from './$types';

/** What the export would contain: plates, objects, filament slots, warnings (any member). */
export const GET: RequestHandler = (event) =>
	respond(() => {
		const q = event.url.searchParams;
		return previewExport(getDb(), event.params.id, requireUserId(event), {
			flavor: parseFlavor(q.get('flavor')),
			plates: parsePlates(q.get('plates'))
		});
	});
