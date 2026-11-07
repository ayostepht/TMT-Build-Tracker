import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BuildKind } from '#lib/domain/types.ts';
import { inactiveSlugs } from '#lib/domain/variants.ts';
import type { Db } from '../db';
import { activity, buildFilaments, buildParts, builds, templates } from '../db/schema';

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

/**
 * Builds with printed/total counts that respect each build's variant choices. Studio drafts
 * (kind 'draft') are left out unless asked for: they are not builds and never count as progress.
 */
export function buildRows(db: Db, orgIds: string[], kind: BuildKind = 'build'): BuildRow[] {
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
		.where(and(inArray(builds.organizationId, orgIds), eq(builds.kind, kind)))
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

export interface DraftRow {
	id: string;
	organizationId: string;
	name: string;
	templateName: string;
	/** Hex colours of the draft's filament slots, in slot order. */
	colors: string[];
	/** Last change (activity, else creation), ms. */
	updated: number;
}

/** Studio drafts in the given workspaces, most recently changed first. */
export function draftRows(db: Db, orgIds: string[]): DraftRow[] {
	if (!orgIds.length) return [];
	const rows = db
		.select({
			id: builds.id,
			organizationId: builds.organizationId,
			name: builds.name,
			templateName: templates.name,
			createdAt: builds.createdAt,
			design: builds.design
		})
		.from(builds)
		.innerJoin(templates, eq(templates.id, builds.templateId))
		.where(and(inArray(builds.organizationId, orgIds), eq(builds.kind, 'draft')))
		.all();
	if (!rows.length) return [];
	const ids = rows.map((r) => r.id);
	const last = new Map(
		db
			.select({ id: activity.buildId, at: sql<number>`max(${activity.at})` })
			.from(activity)
			.where(inArray(activity.buildId, ids))
			.groupBy(activity.buildId)
			.all()
			.map((r) => [r.id, Number(r.at)])
	);
	const fils = db
		.select({
			buildId: buildFilaments.buildId,
			hex: buildFilaments.hex,
			key: buildFilaments.roleKey
		})
		.from(buildFilaments)
		.where(inArray(buildFilaments.buildId, ids))
		.orderBy(sql`${buildFilaments}.rowid`)
		.all();
	return rows
		.map((r) => ({
			id: r.id,
			organizationId: r.organizationId,
			name: r.name,
			templateName: r.templateName,
			colors: fils.filter((f) => f.buildId === r.id).map((f) => f.hex),
			updated: last.get(r.id) ?? r.createdAt.getTime()
		}))
		.sort((a, b) => b.updated - a.updated);
}
