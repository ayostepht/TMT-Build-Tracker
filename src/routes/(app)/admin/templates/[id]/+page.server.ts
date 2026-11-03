import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { isSiteAdmin } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { templateModels, templateParts, templates } from '#lib/server/db/schema.ts';
import { latestJob } from '#lib/server/models/jobs.ts';
import { loadTemplateModelInfo } from '#lib/server/models/info.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const db = getDb();
	if (!locals.user || !isSiteAdmin(db, locals.user)) error(404, 'Not found');
	const t = db.select().from(templates).where(eq(templates.id, params.id)).get();
	if (!t) error(404, 'Not found');
	const row = db
		.select({
			version: templateModels.version,
			size: templateModels.size,
			sourceNote: templateModels.sourceNote,
			createdAt: templateModels.createdAt
		})
		.from(templateModels)
		.where(eq(templateModels.templateId, t.id))
		.get();
	const job = latestJob(db, t.id);
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
		model: loadTemplateModelInfo(db, t.id),
		modelMeta: row
			? { size: row.size, sourceNote: row.sourceNote, createdAt: row.createdAt.toISOString() }
			: null,
		job: job
			? {
					id: job.id,
					status: job.status,
					progress: job.progress,
					message: job.status === 'queued' ? 'Waiting in the queue' : job.message,
					report: job.report,
					createdAt: job.createdAt.toISOString(),
					finishedAt: job.finishedAt?.toISOString() ?? null
				}
			: null
	};
};
