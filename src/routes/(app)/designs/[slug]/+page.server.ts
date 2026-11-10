import { error } from '@sveltejs/kit';
import { ApiError } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { editableTargets, getDesignDetail } from '#lib/server/designs/designs.ts';
import { loadTemplateModel } from '#lib/server/designs/model.ts';
import { isSiteAdmin } from '#lib/server/access.ts';
import { inactiveSlugs } from '#lib/domain/variants.ts';
import { templates } from '#lib/server/db/schema.ts';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(404, 'Not found');
	const db = getDb();
	try {
		const design = await getDesignDetail(db, params.slug, locals.user.id);
		// A design carries no variant choices, so the preview shows each group's default option only. Drawing
		// every alternative (standard and smaller rims, one- and two-piece footrest, ...) puts coplanar faces
		// of different parts on top of each other, which z-fights in the wheel face.
		const groups =
			db
				.select({ g: templates.variantGroups })
				.from(templates)
				.where(eq(templates.id, design.templateId))
				.get()?.g ?? [];
		return {
			design,
			model: loadTemplateModel(db, design.templateId),
			hidden: [...inactiveSlugs(groups, null)],
			targets: editableTargets(db, locals.user.id, design.templateId),
			siteAdmin: isSiteAdmin(db, locals.user)
		};
	} catch (e) {
		if (e instanceof ApiError) error(e.status as 404, e.message);
		throw e;
	}
};
