import { eq } from 'drizzle-orm';
import type { KitStatusDto } from '#lib/domain/kit-import.ts';
import type { Db } from './db/index.ts';
import { templateModels, templateParts } from './db/schema.ts';
import { guideStatus } from './guide.ts';
import { loadTemplateModelInfo } from './models/info.ts';
import { listPrintGeometry } from './print-geometry/import.ts';

/** What the install holds for a template's kit files (model, print geometry, guide, hardware). */
export async function kitStatus(db: Db, templateId: string): Promise<KitStatusDto> {
	const parts = db
		.select()
		.from(templateParts)
		.where(eq(templateParts.templateId, templateId))
		.all();
	const name = new Map(parts.map((p) => [p.slug, p.name]));
	const label = (slug: string) => name.get(slug) ?? slug;

	const info = loadTemplateModelInfo(db, templateId);
	let model: KitStatusDto['model'] = null;
	if (info) {
		const row = db
			.select()
			.from(templateModels)
			.where(eq(templateModels.templateId, templateId))
			.get();
		const has = new Set(info.slugs);
		const placed = new Set(info.placements.filter((p) => p.placed).map((p) => p.slug));
		const inModel = parts.filter((p) => has.has(p.slug));
		model = {
			version: info.version,
			createdAt: row?.createdAt.toISOString() ?? null,
			source: (row?.sourceNote ?? '').split(': ')[0],
			rendered: inModel.length,
			total: parts.length,
			placed: inModel.filter((p) => placed.has(p.slug)).length,
			unplaced: inModel.filter((p) => !placed.has(p.slug)).map((p) => p.name),
			missing: parts.filter((p) => !has.has(p.slug)).map((p) => p.name)
		};
	}

	const rows = listPrintGeometry(db, templateId);
	const imported = rows.filter((r) => r.source !== 'seed');
	const g = await guideStatus(db, templateId);
	return {
		model,
		print: {
			withGeometry: imported.length,
			total: rows.length,
			missing: rows.filter((r) => r.source === 'seed').map((r) => label(r.slug)),
			paintedFaces: imported.reduce((a, r) => a + r.paintedFaces, 0),
			withSettings: imported.filter((r) => Object.keys(r.settings).length).length,
			sources: [...new Set(imported.map((r) => r.source.split(': ')[0]))]
		},
		guide: {
			uploaded: g.uploaded.length,
			pages: g.pages.length,
			mapped: g.pages.filter((p) => p.pdfPage !== null).length
		},
		hardware: !!info?.hardwareUrl
	};
}
