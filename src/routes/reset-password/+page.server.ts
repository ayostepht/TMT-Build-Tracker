import { redirect } from '@sveltejs/kit';
import { appMode } from '#lib/server/config.ts';
import type { PageServerLoad } from './$types';

// Self-hosted only: public mode has no passwords. The token lives in the URL fragment, so
// it never reaches this load function.
export const load: PageServerLoad = () => {
	if (appMode() === 'public') redirect(303, '/login');
	return {};
};
