import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Old tab URL, kept working: the tab now lives at `/print`. */
export const GET: RequestHandler = ({ params, url }) => {
	redirect(308, `/builds/${params.id}/print${url.search}`);
};
