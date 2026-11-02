import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { loadBuildView } from '#lib/server/builds/view.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ params, locals }) => {
	if (!locals.user) error(404, 'Not found');
	const view = loadBuildView(getDb(), params.id, locals.user.id);
	if (!view) error(404, 'Not found');
	return { view };
};
