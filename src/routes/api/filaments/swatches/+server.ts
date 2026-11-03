import { json } from '@sveltejs/kit';
import { catalogResponse } from '#lib/server/filaments/http.ts';
import { swatches, type SwatchFamily } from '#lib/server/filaments/index.ts';
import type { RequestHandler } from './$types';

/** `GET /api/filaments/swatches?family=petg|tpu|other` → `{ family, swatches: [brand, color, hex, material][] }`. */
export const GET: RequestHandler = (event) => {
	const family = event.url.searchParams.get('family')?.toLowerCase() ?? 'petg';
	if (family !== 'petg' && family !== 'tpu' && family !== 'other')
		return json({ error: 'family must be petg, tpu or other' }, { status: 400 });
	return catalogResponse(event, () => ({ family, swatches: swatches(family as SwatchFamily) }));
};
