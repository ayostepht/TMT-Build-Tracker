import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Old tab URL, kept working: the Parts tab is now the Print tab. */
export const GET: RequestHandler = ({ params, url }) => {
	redirect(308, `/builds/${params.id}/print${url.search}`);
};
