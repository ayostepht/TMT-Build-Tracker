import { getDb } from '#lib/server/db/index.ts';
import { listDesigns } from '#lib/server/designs/designs.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// The (app) layout already guards the route; this is for the type.
	const designs = locals.user ? await listDesigns(getDb(), locals.user.id) : [];
	return { designs };
};
