import { isPublicMode } from '#lib/server/config.ts';
import type { PageServerLoad } from './$types';

/** Readable signed out. The mode and whether someone is signed in are the only things the text depends on. */
export const load: PageServerLoad = ({ locals, setHeaders }) => {
	// The text differs for a signed-in visitor: a shared proxy must not serve it to someone else.
	setHeaders({ 'cache-control': 'private, no-cache' });
	return { publicMode: isPublicMode(), signedIn: !!locals.user };
};
