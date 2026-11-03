import { eq } from 'drizzle-orm';
import type { PartPlacement, TemplateModelInfo } from '#lib/domain/types.ts';
import type { Db } from '../db';
import { templateModels, templatePartPlacements } from '../db/schema';

/** The template's 3D model as the viewer needs it (same shape as `BuildView.model`), or null before an admin imports one. */
export function loadTemplateModel(db: Db, templateId: string): TemplateModelInfo | null {
	const row = db
		.select()
		.from(templateModels)
		.where(eq(templateModels.templateId, templateId))
		.get();
	if (!row) return null;
	return {
		url: `/api/templates/${encodeURIComponent(templateId)}/model.glb?v=${encodeURIComponent(row.version)}`,
		version: row.version,
		hardwareUrl: null,
		placements: db
			.select()
			.from(templatePartPlacements)
			.where(eq(templatePartPlacements.templateId, templateId))
			.all()
			.map((r): PartPlacement => ({
				slug: r.slug,
				matrix: r.matrix,
				instances: r.instances,
				placed: r.placed
			})),
		slugs: row.slugs
	};
}
