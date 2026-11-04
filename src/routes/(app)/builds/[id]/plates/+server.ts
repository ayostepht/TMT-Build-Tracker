import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Old tab URL, kept working: plates, printer and export now live in the Files tab. */
export const GET: RequestHandler = ({ params, url }) => {
	redirect(308, `/builds/${params.id}/files${url.search}`);
};
