import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** A Studio draft has no tracking pages: send it to its Design tab. */
export const load: PageServerLoad = async ({ parent, params }) => {
	const { view } = await parent();
	if (view.build.kind === 'draft') redirect(303, `/builds/${params.id}/design`);
};
