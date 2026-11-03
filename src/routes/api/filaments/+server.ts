import { catalogResponse } from '#lib/server/filaments/http.ts';
import { brands, meta } from '#lib/server/filaments/index.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	catalogResponse(event, () => ({ ...meta(), brands: brands() }));
