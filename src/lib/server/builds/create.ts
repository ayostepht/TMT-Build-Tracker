import { eq } from 'drizzle-orm';
import { resolveChoices, validateChoices } from '#lib/domain/variants.ts';
import { ApiError, requireEditor } from '../access';
import type { Db } from '../db';
import {
	activity,
	buildFilaments,
	buildParts,
	buildPlates,
	builds,
	colorDesigns,
	templateFilamentRoles,
	templateParts,
	templatePlates,
	templates
} from '../db/schema';

export interface CreateBuildInput {
	organizationId: string;
	templateId: string;
	designId: string | null;
	name: string;
	recipient?: string | null;
	hospital?: string | null;
	deliveryDate?: string | null;
	/** group key → option key; groups left out get the template default. Unknown keys are rejected. */
	variantChoices?: Record<string, string> | null;
}

/** Create a build from a template (and optional color design) in one transaction. Returns the new id. */
export function createBuild(db: Db, input: CreateBuildInput, userId: string): string {
	requireEditor(db, input.organizationId, userId);
	const name = input.name.trim();
	if (!name) throw new ApiError(400, 'Name is required');
	if (input.deliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate))
		throw new ApiError(400, 'Delivery date must be YYYY-MM-DD');

	return db.transaction((tx) => {
		const tpl = tx.select().from(templates).where(eq(templates.id, input.templateId)).get();
		if (!tpl) throw new ApiError(400, 'Unknown template');

		const choices = input.variantChoices ?? {};
		const badChoice = validateChoices(tpl.variantGroups, choices);
		if (badChoice) throw new ApiError(400, badChoice);

		let design: typeof colorDesigns.$inferSelect | undefined;
		if (input.designId) {
			design = tx.select().from(colorDesigns).where(eq(colorDesigns.id, input.designId)).get();
			if (!design || design.templateId !== tpl.id) throw new ApiError(400, 'Unknown design');
			if (!design.isPublic && design.authorUserId !== userId)
				throw new ApiError(400, 'Unknown design');
		}

		const { id } = tx
			.insert(builds)
			.values({
				organizationId: input.organizationId,
				templateId: tpl.id,
				name,
				recipient: input.recipient?.trim() || null,
				hospital: input.hospital?.trim() || null,
				deliveryDate: input.deliveryDate || null,
				design: design
					? {
							id: design.id,
							slug: design.slug,
							name: design.name,
							roles: design.roles,
							partRoles: design.partRoles
						}
					: null,
				variantChoices: resolveChoices(tpl.variantGroups, choices),
				createdBy: userId
			})
			.returning({ id: builds.id })
			.get();

		const overrides = new Map((design?.roles ?? []).map((r) => [r.key, r]));
		for (const r of tx
			.select()
			.from(templateFilamentRoles)
			.where(eq(templateFilamentRoles.templateId, tpl.id))
			.all()) {
			const o = overrides.get(r.key);
			tx.insert(buildFilaments)
				.values({
					buildId: id,
					roleKey: r.key,
					name: o?.name ?? r.name,
					material: o?.material ?? r.material,
					hex: o?.hex ?? r.hex,
					spools: r.recommendedSpools
				})
				.run();
		}
		// Rows for every part, active or not, so switching variants keeps any progress.
		for (const p of tx
			.select({ slug: templateParts.slug })
			.from(templateParts)
			.where(eq(templateParts.templateId, tpl.id))
			.all()) {
			tx.insert(buildParts).values({ buildId: id, partSlug: p.slug }).run();
		}
		for (const p of tx
			.select()
			.from(templatePlates)
			.where(eq(templatePlates.templateId, tpl.id))
			.all()) {
			tx.insert(buildPlates)
				.values({
					buildId: id,
					number: p.number,
					name: p.name,
					estSeconds: p.estSeconds,
					runs: p.runs,
					perPartRuns: p.perPartRuns,
					parts: p.parts
				})
				.run();
		}
		tx.insert(activity)
			.values({ buildId: id, userId, kind: 'build.create', payload: { name } })
			.run();
		return id;
	});
}
