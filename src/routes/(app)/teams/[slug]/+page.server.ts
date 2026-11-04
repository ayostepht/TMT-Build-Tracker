import { buildRows } from '#lib/server/builds/list.ts';
import { getDb } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { team } = await parent();
	return { builds: buildRows(getDb(), [team.id]) };
};
