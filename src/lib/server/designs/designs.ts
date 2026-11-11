import { statSync } from 'node:fs';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { effectivePartRoles } from '#lib/domain/design.ts';
import { ApiError } from '../access';
import { diskHasRoom } from '../config';
import { loadBuildView } from '../builds/view';
import type { Db } from '../db';
import {
	builds,
	colorDesigns,
	templateFilamentRoles,
	templateParts,
	templates,
	user
} from '../db/schema';
import {
	assertUnder,
	assertUploadRoom,
	countSavedDesigns,
	quotaLimit,
	snapshotWorkspace
} from '../quota';
import { listTeams } from '../teams';
import { canSeeDesign, type DesignRow } from './access';
import {
	hasSnapshot,
	isPng,
	MAX_SNAPSHOT_BYTES,
	removeSnapshot,
	snapshotPath,
	writeSnapshot
} from './files';
import type { DesignRole } from './mutate';

export interface DesignSummary {
	id: string;
	slug: string;
	name: string;
	templateId: string;
	templateName: string;
	authorUserId: string | null;
	authorName: string | null;
	isPublic: boolean;
	mine: boolean;
	createdAt: string;
	roles: DesignRole[];
	/** Parts per slot key (all template parts). */
	partCounts: Record<string, number>;
	hasSnapshot: boolean;
}

export interface DesignDetail extends DesignSummary {
	partRoles: Record<string, string>;
	/** Every template part with the slot this design gives it. */
	parts: { slug: string; name: string; section: string; role: string }[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
function bad(msg: string): never {
	throw new ApiError(400, msg);
}

function designName(v: unknown): string {
	if (typeof v !== 'string' || !v.trim() || v.length > 100) bad('name must be 1 to 100 characters');
	return v.trim();
}

function slugBase(name: string): string {
	return (
		name
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'design'
	);
}

function uniqueSlug(db: Db, name: string): string {
	const base = slugBase(name);
	let slug = base;
	while (
		db.select({ id: colorDesigns.id }).from(colorDesigns).where(eq(colorDesigns.slug, slug)).get()
	)
		slug = `${base}-${crypto.randomUUID().slice(0, 4)}`;
	return slug;
}

/** Design by id or slug (both are unique and URL-safe), only when the user may see it. */
export function findDesign(db: Db, key: string, userId: string): DesignRow {
	const d =
		db.select().from(colorDesigns).where(eq(colorDesigns.id, key)).get() ??
		db.select().from(colorDesigns).where(eq(colorDesigns.slug, key)).get();
	if (!d || !canSeeDesign(db, d, userId)) throw new ApiError(404, 'Not found');
	return d;
}

function requireAuthor(d: DesignRow, userId: string): void {
	if (d.authorUserId !== userId) throw new ApiError(403, 'Only the author can do this');
}

async function summarize(db: Db, rows: DesignRow[], userId: string): Promise<DesignSummary[]> {
	if (!rows.length) return [];
	const tplIds = [...new Set(rows.map((r) => r.templateId))];
	const tplNames = new Map(
		db
			.select({ id: templates.id, name: templates.name })
			.from(templates)
			.where(inArray(templates.id, tplIds))
			.all()
			.map((t) => [t.id, t.name])
	);
	const defaults = new Map<string, Map<string, string>>();
	for (const id of tplIds)
		defaults.set(
			id,
			new Map(
				db
					.select({ slug: templateParts.slug, role: templateParts.defaultRole })
					.from(templateParts)
					.where(eq(templateParts.templateId, id))
					.all()
					.map((p) => [p.slug, p.role])
			)
		);
	const authorIds = [...new Set(rows.map((r) => r.authorUserId).filter((x): x is string => !!x))];
	const authors = new Map(
		authorIds.length
			? db
					.select({ id: user.id, name: user.name })
					.from(user)
					.where(inArray(user.id, authorIds))
					.all()
					.map((u) => [u.id, u.name])
			: []
	);
	return Promise.all(
		rows.map(async (d) => {
			const counts: Record<string, number> = {};
			for (const [slug, def] of defaults.get(d.templateId) ?? []) {
				const r = d.partRoles[slug] ?? def;
				counts[r] = (counts[r] ?? 0) + 1;
			}
			return {
				id: d.id,
				slug: d.slug,
				name: d.name,
				templateId: d.templateId,
				templateName: tplNames.get(d.templateId) ?? '',
				authorUserId: d.authorUserId,
				authorName: d.authorUserId ? (authors.get(d.authorUserId) ?? null) : null,
				isPublic: d.isPublic,
				mine: d.authorUserId === userId,
				createdAt: d.createdAt.toISOString(),
				roles: d.roles,
				partCounts: counts,
				hasSnapshot: await hasSnapshot(d.id)
			};
		})
	);
}

/** Designs the user may see (public, their own, their co-members'), newest first. */
export async function listDesigns(
	db: Db,
	userId: string,
	opts: { templateId?: string } = {}
): Promise<DesignSummary[]> {
	const rows = db
		.select()
		.from(colorDesigns)
		.orderBy(desc(colorDesigns.createdAt), asc(colorDesigns.name))
		.all()
		.filter(
			(d) => (!opts.templateId || d.templateId === opts.templateId) && canSeeDesign(db, d, userId)
		);
	return summarize(db, rows, userId);
}

export async function getDesignDetail(db: Db, key: string, userId: string): Promise<DesignDetail> {
	const d = findDesign(db, key, userId);
	const [s] = await summarize(db, [d], userId);
	const parts = db
		.select()
		.from(templateParts)
		.where(eq(templateParts.templateId, d.templateId))
		.orderBy(asc(templateParts.sort))
		.all()
		.map((p) => ({
			slug: p.slug,
			name: p.name,
			section: p.section,
			role: d.partRoles[p.slug] ?? p.defaultRole
		}));
	return { ...s, partRoles: d.partRoles, parts };
}

/** Save a build's current colors as a design. Editors and owners of the build. */
export function createDesign(db: Db, userId: string, body: unknown): { id: string; slug: string } {
	if (!isObj(body)) bad('Invalid body');
	if (typeof body.buildId !== 'string') bad('buildId is required');
	const name = designName(body.name);
	if (body.isPublic !== undefined && typeof body.isPublic !== 'boolean')
		bad('isPublic must be true or false');
	const view = loadBuildView(db, body.buildId, userId);
	if (!view) throw new ApiError(404, 'Not found');
	if (!view.canEdit) throw new ApiError(403, 'Your role cannot edit');
	const roles: DesignRole[] = view.filaments.map((f) => ({
		key: f.key,
		name: f.name,
		material: f.material,
		hex: f.hex
	}));
	const row = db.transaction((tx) => {
		assertUnder(tx, 'savedDesignsPerUser', () => countSavedDesigns(tx, userId), { userId });
		return tx
			.insert(colorDesigns)
			.values({
				templateId: view.build.templateId,
				slug: uniqueSlug(db, name),
				name,
				authorUserId: userId,
				roles,
				partRoles: effectivePartRoles(view),
				isPublic: body.isPublic === true
			})
			.returning({ id: colorDesigns.id, slug: colorDesigns.slug })
			.get();
	});
	return row;
}

/** Rename or publish/unpublish. Author only. */
export function updateDesignMeta(db: Db, key: string, userId: string, body: unknown): void {
	if (!isObj(body)) bad('Invalid body');
	const d = findDesign(db, key, userId);
	requireAuthor(d, userId);
	const set: Partial<typeof colorDesigns.$inferInsert> = {};
	if (body.name !== undefined) set.name = designName(body.name);
	if (body.isPublic !== undefined) {
		if (typeof body.isPublic !== 'boolean') bad('isPublic must be true or false');
		set.isPublic = body.isPublic;
	}
	if (!Object.keys(set).length) bad('Nothing to update');
	db.update(colorDesigns).set(set).where(eq(colorDesigns.id, d.id)).run();
}

/** Delete a design. Author only. Builds keep their own snapshot of the colors. */
export async function deleteDesign(db: Db, key: string, userId: string): Promise<void> {
	const d = findDesign(db, key, userId);
	requireAuthor(d, userId);
	db.delete(colorDesigns).where(eq(colorDesigns.id, d.id)).run();
	await removeSnapshot(d.id);
}

/** Template slot keys that exist in the kit itself (used by the UI to tell built-in slots from added colors). */
export function templateRoleKeys(db: Db, templateId: string): string[] {
	return db
		.select({ k: templateFilamentRoles.key })
		.from(templateFilamentRoles)
		.where(eq(templateFilamentRoles.templateId, templateId))
		.all()
		.map((r) => r.k);
}

/** Store the PNG preview of a design. Author only; PNG up to 2 MB. */
export async function saveSnapshot(
	db: Db,
	key: string,
	userId: string,
	bytes: Uint8Array
): Promise<void> {
	const d = findDesign(db, key, userId);
	requireAuthor(d, userId);
	if (bytes.length > MAX_SNAPSHOT_BYTES) throw new ApiError(413, 'Image is larger than 2 MB');
	if (!isPng(bytes)) bad('The preview must be a PNG image');
	if (!diskHasRoom()) throw new ApiError(507, 'The server is almost out of disk space');
	// Charged to the author's personal workspace; replacing a preview only adds the difference.
	if (quotaLimit('uploadBytesPerWorkspace') !== null || quotaLimit('uploadBytesPerUser') !== null) {
		const org = snapshotWorkspace(db, userId);
		if (org) {
			let old = 0;
			try {
				old = statSync(snapshotPath(d.id)).size;
			} catch {
				/* no preview yet */
			}
			assertUploadRoom(db, org, Math.max(1, bytes.length - old), { userId });
		}
	}
	await writeSnapshot(d.id, bytes);
}

/** Workspaces and builds the user can edit for a template, for "Start a build" and "Copy into my build". */
export function editableTargets(
	db: Db,
	userId: string,
	templateId: string
): {
	workspaces: { id: string; name: string }[];
	builds: { id: string; name: string; workspaceName: string }[];
} {
	const teams = listTeams(db, userId)
		.filter((t) => t.role === 'owner' || t.role === 'editor')
		.map((t) => ({ id: t.id, name: t.personal ? 'My builds' : t.name }));
	const byId = new Map(teams.map((t) => [t.id, t.name]));
	if (!teams.length) return { workspaces: [], builds: [] };
	const rows = db
		.select({ id: builds.id, name: builds.name, org: builds.organizationId })
		.from(builds)
		.where(and(eq(builds.templateId, templateId), inArray(builds.organizationId, [...byId.keys()])))
		.orderBy(asc(builds.name))
		.all();
	return {
		workspaces: teams,
		builds: rows.map((r) => ({ id: r.id, name: r.name, workspaceName: byId.get(r.org) ?? '' }))
	};
}
