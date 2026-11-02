import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import {
	colorDesigns,
	templateFilamentRoles,
	templateGuidePages,
	templateHardware,
	templateParts,
	templatePlates,
	templates
} from '../db/schema';
import type { TemplateSeed } from './types';

/** Inserts each seed whose slug is not yet present. Idempotent; one transaction per template. */
export function seedTemplates(db: Db, seeds: TemplateSeed[]): { inserted: string[] } {
	const inserted: string[] = [];
	for (const s of seeds) {
		const exists = db
			.select({ id: templates.id })
			.from(templates)
			.where(eq(templates.slug, s.slug))
			.get();
		if (exists) continue;
		db.transaction((tx) => {
			const t = tx
				.insert(templates)
				.values({
					slug: s.slug,
					name: s.name,
					version: s.version,
					description: s.description,
					sourceUrl: s.sourceUrl ?? null,
					globalSettings: s.globalSettings,
					sections: s.sections
				})
				.returning({ id: templates.id })
				.get();
			const templateId = t.id;
			for (const r of s.filamentRoles) {
				tx.insert(templateFilamentRoles)
					.values({ templateId, ...r })
					.run();
			}
			s.parts.forEach((p, i) => {
				tx.insert(templateParts)
					.values({
						templateId,
						slug: p.slug,
						name: p.name,
						section: p.section,
						defaultRole: p.defaultRole,
						bomGrams: p.bomGrams,
						qty: p.qty,
						walls: p.walls,
						infill: p.infill,
						supports: p.supports,
						brim: p.brim ?? null,
						sourceFile: p.sourceFile,
						notes: p.notes,
						components: p.components ?? [],
						allowedMaterials: p.allowedMaterials,
						symmetryGroup: p.symmetryGroup ?? null,
						guideRefs: p.guideRefs,
						sort: i
					})
					.run();
			});
			for (const p of s.plates) {
				tx.insert(templatePlates)
					.values({
						templateId,
						number: p.number,
						name: p.name,
						estSeconds: p.estSeconds,
						runs: p.runs,
						runNote: p.runNote ?? null,
						perPartRuns: p.perPartRuns ?? false,
						parts: p.parts
					})
					.run();
			}
			for (const g of s.guidePages) {
				tx.insert(templateGuidePages)
					.values({ templateId, ...g })
					.run();
			}
			for (const h of s.hardware) {
				tx.insert(templateHardware)
					.values({ templateId, name: h.name, qty: h.qty ?? null, note: h.note ?? null })
					.run();
			}
			for (const d of s.designs) {
				tx.insert(colorDesigns)
					.values({
						templateId,
						slug: d.slug,
						name: d.name,
						roles: d.roles,
						partRoles: d.partRoles,
						isPublic: true
					})
					.run();
			}
		});
		inserted.push(s.slug);
	}
	return { inserted };
}
