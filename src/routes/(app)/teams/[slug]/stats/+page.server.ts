import { getDb } from '#lib/server/db/index.ts';
import { loadWorkspaceStats } from '#lib/server/stats/workspace.ts';
import type { PageServerLoad } from './$types';

/** Stats across a workspace's builds. The layout already 404s non-members; the loader checks again. */
export const load: PageServerLoad = async ({ parent, locals, url }) => {
	const { team } = await parent();
	const stats = loadWorkspaceStats(getDb(), team.id, locals.user!.id, {
		months: url.searchParams.get('months')
	});
	return { stats };
};
