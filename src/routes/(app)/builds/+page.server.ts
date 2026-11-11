import { buildRows } from '#lib/server/builds/list.ts';
import { getDb } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

/** Every build the user can see: all their chapters plus My builds, grouped by where it lives. */
export const load: PageServerLoad = async ({ parent }) => {
	const { teams } = await parent();
	const rows = buildRows(
		getDb(),
		teams.map((t) => t.id)
	);
	const groups = teams.map((t) => ({
		id: t.id,
		name: t.name,
		slug: t.slug,
		personal: t.personal,
		role: t.role,
		builds: rows.filter((b) => b.organizationId === t.id)
	}));
	// Chapters first, My builds last.
	groups.sort((a, b) => Number(a.personal) - Number(b.personal));
	return { groups };
};
