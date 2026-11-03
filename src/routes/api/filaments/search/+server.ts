import { catalogResponse } from '#lib/server/filaments/http.ts';
import { search } from '#lib/server/filaments/index.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	catalogResponse(event, () => ({ results: search(event.url.searchParams.get('q') ?? '', 50) }));
