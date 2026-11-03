import { catalogResponse } from '#lib/server/filaments/http.ts';
import { colors } from '#lib/server/filaments/index.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	catalogResponse(event, () => {
		const p = event.url.searchParams;
		return { colors: colors(p.get('brand') ?? '', p.get('material') ?? '') };
	});
