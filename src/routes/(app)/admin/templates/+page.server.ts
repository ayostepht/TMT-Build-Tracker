import { error } from '@sveltejs/kit';
import { count, eq } from 'drizzle-orm';
import { isSiteAdmin } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { templateModels, templateParts, templatePlates, templates } from '#lib/server/db/schema.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	if (!locals.user || !isSiteAdmin(db, locals.user)) error(404, 'Not found');
	const n = (table: typeof templateParts | typeof templatePlates, id: string) =>
		db.select({ n: count() }).from(table).where(eq(table.templateId, id)).get()?.n ?? 0;
	return {
		templates: db
			.select()
			.from(templates)
			.all()
			.map((t) => {
				const model = db
					.select({ version: templateModels.version, size: templateModels.size })
					.from(templateModels)
					.where(eq(templateModels.templateId, t.id))
					.get();
				return {
					id: t.id,
					name: t.name,
					version: t.version,
					parts: n(templateParts, t.id),
					plates: n(templatePlates, t.id),
					variantGroups: t.variantGroups.length,
					model: model ?? null
				};
			})
	};
};
