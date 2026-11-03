import { error } from '@sveltejs/kit';
import { ApiError } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { editableTargets, getDesignDetail } from '#lib/server/designs/designs.ts';
import { loadTemplateModel } from '#lib/server/designs/model.ts';
import { isSiteAdmin } from '#lib/server/access.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(404, 'Not found');
	const db = getDb();
	try {
		const design = await getDesignDetail(db, params.slug, locals.user.id);
		return {
			design,
			model: loadTemplateModel(db, design.templateId),
			targets: editableTargets(db, locals.user.id, design.templateId),
			siteAdmin: isSiteAdmin(db, locals.user)
		};
	} catch (e) {
		if (e instanceof ApiError) error(e.status as 404, e.message);
		throw e;
	}
};
