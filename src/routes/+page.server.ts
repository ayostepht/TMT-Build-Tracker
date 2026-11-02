import { redirect } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.ts';
import { templateParts, templatePlates, templates } from '#lib/server/db/schema.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const db = getDb();
	const rows = db
		.select({
			id: templates.id,
			name: templates.name,
			version: templates.version,
			description: templates.description,
			parts: sql<number>`(select count(*) from ${templateParts} where ${templateParts.templateId} = ${templates.id})`,
			plates: sql<number>`(select count(*) from ${templatePlates} where ${templatePlates.templateId} = ${templates.id})`
		})
		.from(templates)
		.all();
	return { user: { name: locals.user.name, email: locals.user.email }, templates: rows };
};
