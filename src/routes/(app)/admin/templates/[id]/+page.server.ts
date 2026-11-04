import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { isSiteAdmin } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { templateParts, templates } from '#lib/server/db/schema.ts';
import { loadTemplateModelInfo } from '#lib/server/models/info.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const db = getDb();
	if (!locals.user || !isSiteAdmin(db, locals.user)) error(404, 'Not found');
	const t = db.select().from(templates).where(eq(templates.id, params.id)).get();
	if (!t) error(404, 'Not found');
	return {
		template: { id: t.id, name: t.name, version: t.version },
		parts: db
			.select({
				slug: templateParts.slug,
				name: templateParts.name,
				section: templateParts.section,
				sourceFile: templateParts.sourceFile
			})
			.from(templateParts)
			.where(eq(templateParts.templateId, t.id))
			.orderBy(asc(templateParts.sort))
			.all(),
		model: loadTemplateModelInfo(db, t.id)
	};
};
