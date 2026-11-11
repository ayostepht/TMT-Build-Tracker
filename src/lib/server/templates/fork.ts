import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import {
	ApiError,
	canEditRole,
	getMemberRole,
	isSiteAdmin,
	requireEditor,
	type SiteAdminCandidate
} from '../access';
import type { Db } from '../db';
import {
	builds,
	templateAssemblySteps,
	templateFilamentRoles,
	templateGuidePages,
	templateHardware,
	templatePartPlacements,
	templateParts,
	templatePlateLayouts,
	templatePlates,
	templatePrintGeometry,
	templates
} from '../db/schema';

/** `template_print_geometry.source_note` of rows that carry seed footprints only (no mesh file). */
const SEED_NOTE = 'seed';

/** Templates a workspace can start a build from: every global one plus the workspace's own copies. */
export function listTemplatesFor(db: Db, orgId: string) {
	return db
		.select()
		.from(templates)
		.where(or(isNull(templates.ownerOrgId), eq(templates.ownerOrgId, orgId)))
		.orderBy(asc(templates.createdAt), asc(templates.name))
		.all();
}

/** The template a new build starts on: the oldest global one (the built-in MakeGood kit). */
export function defaultTemplate(db: Db) {
	const t = db
		.select()
		.from(templates)
		.where(isNull(templates.ownerOrgId))
		.orderBy(asc(templates.createdAt), asc(templates.name))
		.limit(1)
		.get();
	if (!t) throw new ApiError(500, 'No template is installed');
	return t;
}

/**
 * May this user add or replace kit files of the template? Global templates: site admins only
 * (imports are install-wide). A workspace's own template: owners and editors of that workspace.
 */
export function canManageTemplate(db: Db, user: SiteAdminCandidate, templateId: string): boolean {
	const t = db
		.select({ ownerOrgId: templates.ownerOrgId })
		.from(templates)
		.where(eq(templates.id, templateId))
		.get();
	if (!t) return false;
	if (!t.ownerOrgId) return isSiteAdmin(db, user);
	const role = getMemberRole(db, t.ownerOrgId, user.id);
	return !!role && canEditRole(role);
}

function uniqueSlug(db: Db, base: string): string {
	let slug = base;
	while (db.select({ id: templates.id }).from(templates).where(eq(templates.slug, slug)).get())
		slug = `${base.slice(0, 50)}-${crypto.randomUUID().slice(0, 4)}`;
	return slug;
}

function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 30) || 'kit'
	);
}

/**
 * Copies a template's static data (filament roles, parts, plates, plate layouts, guide page titles,
 * hardware, assembly steps, placements, seed print footprints) into a new template owned by the
 * workspace. Builds, color designs, the 3D model and imported print geometry are not copied: the
 * workspace adds its own files to the copy. Returns the new template id.
 */
export function forkTemplate(db: Db, orgId: string, baseTemplateId: string, name: string): string {
	const title = name.trim().slice(0, 120);
	if (!title) throw new ApiError(400, 'Name is required');
	return db.transaction((txRaw) => {
		const tx = txRaw as unknown as Db;
		const base = tx.select().from(templates).where(eq(templates.id, baseTemplateId)).get();
		if (!base) throw new ApiError(404, 'Template not found');
		// Fork the original kit, not a fork of it.
		const rootId = base.baseTemplateId ?? base.id;
		const { id } = tx
			.insert(templates)
			.values({
				slug: uniqueSlug(tx, `${slugify(title)}-${orgId.slice(0, 6)}`),
				name: title,
				version: base.version,
				description: base.description,
				sourceUrl: base.sourceUrl,
				globalSettings: base.globalSettings,
				sections: base.sections,
				variantGroups: base.variantGroups,
				ownerOrgId: orgId,
				baseTemplateId: rootId
			})
			.returning({ id: templates.id })
			.get();

		const re = <T extends { templateId: string }>(rows: T[]) =>
			rows.map((r) => ({ ...r, templateId: id }));

		const roles = tx
			.select()
			.from(templateFilamentRoles)
			.where(eq(templateFilamentRoles.templateId, baseTemplateId))
			.all();
		if (roles.length) tx.insert(templateFilamentRoles).values(re(roles)).run();
		const parts = tx
			.select()
			.from(templateParts)
			.where(eq(templateParts.templateId, baseTemplateId))
			.all();
		if (parts.length) tx.insert(templateParts).values(re(parts)).run();
		const plates = tx
			.select()
			.from(templatePlates)
			.where(eq(templatePlates.templateId, baseTemplateId))
			.all();
		if (plates.length) tx.insert(templatePlates).values(re(plates)).run();
		const guide = tx
			.select()
			.from(templateGuidePages)
			.where(eq(templateGuidePages.templateId, baseTemplateId))
			.all();
		if (guide.length)
			tx.insert(templateGuidePages)
				.values(re(guide).map((g) => ({ ...g, imagePath: null })))
				.run();
		const hardware = tx
			.select()
			.from(templateHardware)
			.where(eq(templateHardware.templateId, baseTemplateId))
			.all();
		if (hardware.length) tx.insert(templateHardware).values(re(hardware)).run();
		const steps = tx
			.select()
			.from(templateAssemblySteps)
			.where(eq(templateAssemblySteps.templateId, baseTemplateId))
			.all();
		if (steps.length) tx.insert(templateAssemblySteps).values(re(steps)).run();
		const layouts = tx
			.select()
			.from(templatePlateLayouts)
			.where(eq(templatePlateLayouts.templateId, baseTemplateId))
			.all();
		if (layouts.length) tx.insert(templatePlateLayouts).values(re(layouts)).run();
		const placements = tx
			.select()
			.from(templatePartPlacements)
			.where(eq(templatePartPlacements.templateId, baseTemplateId))
			.all();
		if (placements.length) tx.insert(templatePartPlacements).values(re(placements)).run();
		const geometry = tx
			.select()
			.from(templatePrintGeometry)
			.where(
				and(
					eq(templatePrintGeometry.templateId, baseTemplateId),
					eq(templatePrintGeometry.sourceNote, SEED_NOTE)
				)
			)
			.all();
		if (geometry.length) tx.insert(templatePrintGeometry).values(re(geometry)).run();
		return id;
	});
}

/**
 * Setup wizard, step 1: point the build at the built-in kit (`own: false`) or at a workspace-owned
 * copy (`own: true`, created on first use and reused afterwards). Both share the same part slugs,
 * so the build's parts, plates and colors carry over unchanged.
 */
export function chooseBuildTemplate(
	db: Db,
	buildId: string,
	userId: string,
	own: boolean
): { templateId: string } {
	const b = db.select().from(builds).where(eq(builds.id, buildId)).get();
	if (!b) throw new ApiError(404, 'Not found');
	requireEditor(db, b.organizationId, userId);
	const cur = db.select().from(templates).where(eq(templates.id, b.templateId)).get();
	if (!cur) throw new ApiError(404, 'Not found');
	const rootId = cur.baseTemplateId ?? cur.id;
	let target: string;
	if (!own) target = rootId;
	else if (cur.ownerOrgId) target = cur.id;
	else {
		const title = `${b.name} chair`;
		const existing = db
			.select({ id: templates.id })
			.from(templates)
			.where(
				and(
					eq(templates.ownerOrgId, b.organizationId),
					eq(templates.baseTemplateId, rootId),
					eq(templates.name, title)
				)
			)
			.orderBy(desc(templates.createdAt))
			.get();
		target = existing?.id ?? forkTemplate(db, b.organizationId, rootId, title);
	}
	if (target !== b.templateId)
		db.update(builds).set({ templateId: target }).where(eq(builds.id, buildId)).run();
	return { templateId: target };
}
