import { desc, eq, inArray, sql } from 'drizzle-orm';
import { inactiveSlugs } from '#lib/domain/variants.ts';
import type { Db } from '../db';
import { activity, buildParts, builds, templates } from '../db/schema';

export interface BuildRow {
	id: string;
	organizationId: string;
	name: string;
	phase: string;
	deliveryDate: string | null;
	setupStep: number | null;
	total: number;
	printed: number;
	progress: number;
	/** Creation time, ms. */
	created: number;
}

/** Builds with printed/total counts that respect each build's variant choices. */
export function buildRows(db: Db, orgIds: string[]): BuildRow[] {
	if (!orgIds.length) return [];
	const groupsByTemplate = new Map(
		db
			.select({ id: templates.id, groups: templates.variantGroups })
			.from(templates)
			.all()
			.map((t) => [t.id, t.groups])
	);
	return db
		.select({
			id: builds.id,
			organizationId: builds.organizationId,
			name: builds.name,
			phase: builds.phase,
			deliveryDate: builds.deliveryDate,
			setupStep: builds.setupStep,
			templateId: builds.templateId,
			createdAt: builds.createdAt,
			choices: builds.variantChoices
		})
		.from(builds)
		.where(inArray(builds.organizationId, orgIds))
		.orderBy(sql`${builds.createdAt} desc`)
		.all()
		.map(({ templateId, choices, createdAt, ...b }) => {
			const off = inactiveSlugs(groupsByTemplate.get(templateId) ?? [], choices);
			const rows = db
				.select({ slug: buildParts.partSlug, status: buildParts.status })
				.from(buildParts)
				.where(eq(buildParts.buildId, b.id))
				.all()
				.filter((r) => !off.has(r.slug));
			const total = rows.length;
			const printed = rows.filter((r) => r.status === 'Printed').length;
			return {
				...b,
				created: createdAt.getTime(),
				total,
				printed,
				progress: total ? Math.round((printed / total) * 100) : 0
			};
		});
}

/** The builds touched most recently (last activity, else creation) across the given workspaces. */
export function recentBuilds(db: Db, orgIds: string[], limit = 6): BuildRow[] {
	const rows = buildRows(db, orgIds);
	if (rows.length <= 1) return rows;
	const last = new Map(
		db
			.select({ id: activity.buildId, at: sql<number>`max(${activity.at})` })
			.from(activity)
			.where(
				inArray(
					activity.buildId,
					rows.map((r) => r.id)
				)
			)
			.groupBy(activity.buildId)
			.orderBy(desc(sql`max(${activity.at})`))
			.all()
			.map((r) => [r.id, Number(r.at)])
	);
	// `rows` is newest-created first; a stable sort keeps that order for builds without activity.
	return [...rows]
		.sort((a, b) => (last.get(b.id) ?? b.created) - (last.get(a.id) ?? a.created))
		.slice(0, limit);
}
