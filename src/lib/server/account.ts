/**
 * Account deletion, data export and file cleanup for deleted workspaces.
 *
 * No schema change: `builds.created_by` has no ON DELETE rule, so deletion reassigns those rows in
 * code, in one synchronous transaction, and removes files on disk only after it commits.
 *
 * What deleting an account does:
 * - the personal workspace goes with everything in it (builds, drafts, photos, uploads, printers,
 *   custom filaments, kit copies), files included; the user's saved designs and previews go too;
 * - in a chapter with other members the membership is removed; builds the user created stay with
 *   the chapter (created_by moves to a chapter owner, else another member); the user's Studio
 *   drafts in chapters are deleted; activity and run rows keep their text but lose the person
 *   (user_id becomes null, so they show as "Someone": nothing keeps the name or email);
 * - a chapter where the user is the only member is deleted with its files;
 * - a chapter where the user is the only owner but others are members blocks the deletion
 *   ("Make someone else an owner of <chapter> first");
 * - sessions, OAuth links, verification rows and invitations sent by or addressed to the user go.
 */
import { rm, unlink } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { and, asc, eq, inArray, like, notInArray, or, sql } from 'drizzle-orm';
import { ApiError, isSiteAdmin, normalizeRole } from './access';
import { uploadsDir } from './config';
import type { Db } from './db';
import {
	buildPhotos,
	builds,
	buildUploads,
	colorDesigns,
	customFilaments,
	invitation,
	member,
	organization,
	templateModelJobs,
	templates,
	user,
	verification
} from './db/schema';
import { repointBuildsOffTemplates } from './builds/repoint';
import { loadBuildView } from './builds/view';
import { removeSnapshot } from './designs/files';
import { removeTemplateFiles } from './templates/files';
import { parseMetadata } from './teams';

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

// ---- files of deleted workspaces

/** Everything on disk that belongs to rows about to be deleted. Collected BEFORE the rows go. */
export interface FilePlan {
	/** Absolute directories to remove recursively. */
	dirs: string[];
	/** Absolute files to remove. */
	files: string[];
	/** Kit copies (templates owned by a deleted workspace): their model, print and guide files. */
	templateIds: string[];
	/** Queued STEP zips of those kit copies' conversion jobs. */
	jobInputs: string[];
}

export const emptyPlan = (): FilePlan => ({ dirs: [], files: [], templateIds: [], jobInputs: [] });

function insideUploads(p: string): boolean {
	const root = resolve(uploadsDir());
	const abs = resolve(p);
	return abs.startsWith(root + sep);
}

/** Resolve a stored path (relative to uploads, or absolute) and keep it only when it stays inside uploads. */
function storedPath(rel: string | null | undefined): string | null {
	if (!rel) return null;
	const abs = resolve(uploadsDir(), rel);
	return insideUploads(abs) ? abs : null;
}

/**
 * Files behind the builds of `orgIds` (plus the single `buildIds`), and the kit copies owned by
 * `orgIds`. Read-only; call it before deleting the rows.
 */
export function planFiles(db: Db, opts: { orgIds?: string[]; buildIds?: string[] }): FilePlan {
	const plan = emptyPlan();
	const orgIds = opts.orgIds ?? [];
	const ids = new Set(opts.buildIds ?? []);
	if (orgIds.length)
		for (const r of db
			.select({ id: builds.id })
			.from(builds)
			.where(inArray(builds.organizationId, orgIds))
			.all())
			ids.add(r.id);
	const buildIds = [...ids].filter((i) => SAFE_ID.test(i));
	const root = uploadsDir();
	for (const id of buildIds) {
		plan.dirs.push(join(root, 'photos', id), join(root, 'plates', id));
	}
	if (buildIds.length) {
		for (const p of db
			.select({ path: buildPhotos.path, thumb: buildPhotos.thumbPath })
			.from(buildPhotos)
			.where(inArray(buildPhotos.buildId, buildIds))
			.all())
			for (const f of [storedPath(p.path), storedPath(p.thumb)]) if (f) plan.files.push(f);
		for (const u of db
			.select({ id: buildUploads.id })
			.from(buildUploads)
			.where(inArray(buildUploads.buildId, buildIds))
			.all())
			if (SAFE_ID.test(u.id)) plan.dirs.push(join(root, '3mf', u.id));
	}
	if (orgIds.length) {
		plan.templateIds = db
			.select({ id: templates.id })
			.from(templates)
			.where(inArray(templates.ownerOrgId, orgIds))
			.all()
			.map((t) => t.id);
		if (plan.templateIds.length)
			plan.jobInputs = db
				.select({ p: templateModelJobs.inputPath })
				.from(templateModelJobs)
				.where(inArray(templateModelJobs.templateId, plan.templateIds))
				.all()
				.map((j) => j.p);
	}
	return plan;
}

/**
 * Delete the kit copies owned by these workspaces (their child rows cascade). Needed because
 * migration 0007 added `templates.owner_org_id` without ON DELETE CASCADE, so deleting the
 * workspace row alone fails on the foreign key. Call after `repointBuildsOffTemplates`; it also deletes the owning workspace's own builds that use the copies.
 */
export function deleteOwnedTemplates(tx: Db, templateIds: string[]): void {
	if (!templateIds.length) return;
	// Builds still using a copy are the owning workspace's own (the repoint moved the others); they
	// go with that workspace anyway, and must go first because builds.template_id has no ON DELETE.
	tx.delete(builds).where(inArray(builds.templateId, templateIds)).run();
	tx.delete(templates).where(inArray(templates.id, templateIds)).run();
}

/** Remove the planned files. Never throws for files that are already gone. */
export async function removePlannedFiles(plan: FilePlan): Promise<void> {
	for (const f of plan.files) await unlink(f).catch(() => {});
	for (const d of plan.dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
	for (const j of plan.jobInputs) if (insideUploads(j)) await unlink(j).catch(() => {});
	for (const t of plan.templateIds) await removeTemplateFiles(t).catch(() => {});
}

// ---- deletion

export interface WorkspaceFate {
	orgId: string;
	name: string;
	/** `personal`: deleted with the account. `delete`: a chapter only this user belongs to. `leave`: others stay. `blocked`: sole owner of a chapter with other members. */
	fate: 'personal' | 'delete' | 'leave' | 'blocked';
	/** Who inherits the builds the user created (leave only). */
	heirId?: string;
}

/** What deleting the account would do to each workspace the user belongs to (read-only). */
export function planAccountDeletion(db: Db, userId: string): WorkspaceFate[] {
	const mine = db
		.select({
			orgId: organization.id,
			name: organization.name,
			metadata: organization.metadata,
			role: member.role
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(eq(member.userId, userId))
		.orderBy(asc(organization.name))
		.all();
	const out: WorkspaceFate[] = [];
	for (const m of mine) {
		const meta = parseMetadata(m.metadata);
		if (meta.personal === true && meta.userId === userId) {
			out.push({ orgId: m.orgId, name: m.name, fate: 'personal' });
			continue;
		}
		const others = db
			.select({ userId: member.userId, role: member.role })
			.from(member)
			.where(eq(member.organizationId, m.orgId))
			.orderBy(asc(member.createdAt), sql`rowid`)
			.all()
			.filter((o) => o.userId !== userId);
		if (!others.length) {
			out.push({ orgId: m.orgId, name: m.name, fate: 'delete' });
			continue;
		}
		const heir = others.find((o) => normalizeRole(o.role) === 'owner');
		if (normalizeRole(m.role) === 'owner' && !heir) {
			out.push({ orgId: m.orgId, name: m.name, fate: 'blocked' });
			continue;
		}
		out.push({ orgId: m.orgId, name: m.name, fate: 'leave', heirId: (heir ?? others[0]).userId });
	}
	return out;
}

/** Refusal that carries a machine-readable code (`last_admin`, `only_account`). */
export class AccountDeletionError extends ApiError {
	constructor(
		message: string,
		public code: 'last_admin' | 'only_account'
	) {
		super(409, message);
	}
}

export const LAST_ADMIN_MESSAGE =
	'You are the only site admin. Another account must become a site admin before you can delete yours.';
export const ONLY_ACCOUNT_MESSAGE =
	'This is the only account on the server, so it cannot be deleted. To start over, remove the data directory.';

/** Why the account may not be deleted for site-wide reasons, or null. */
export function siteBlock(db: Db, userId: string): AccountDeletionError | null {
	const all = db
		.select({ id: user.id, email: user.email, emailVerified: user.emailVerified })
		.from(user)
		.all();
	const me = all.find((x) => x.id === userId);
	if (!me) return null;
	const others = all.filter((x) => x.id !== userId);
	if (!others.length) return new AccountDeletionError(ONLY_ACCOUNT_MESSAGE, 'only_account');
	if (isSiteAdmin(db, me) && !others.some((o) => isSiteAdmin(db, o)))
		return new AccountDeletionError(LAST_ADMIN_MESSAGE, 'last_admin');
	return null;
}

export function blockedMessage(names: string[]): string {
	return names.length === 1
		? `Make someone else an owner of ${names[0]} first`
		: `Make someone else an owner of ${names.join(', ')} first`;
}

export interface DeletionResult {
	deletedWorkspaces: string[];
	leftChapters: string[];
}

/**
 * Delete a user and what belongs only to them (see the file header). One transaction; the files
 * go afterwards. Throws `ApiError(409)` and changes nothing when the user is the sole owner of a
 * chapter that has other members. The caller has already checked who is asking (typed email,
 * fresh sign-in).
 */
export async function deleteAccount(db: Db, userId: string): Promise<DeletionResult> {
	let plan = emptyPlan();
	const result: DeletionResult = { deletedWorkspaces: [], leftChapters: [] };
	let designIds: string[] = [];

	db.transaction((tx) => {
		const u = tx.select().from(user).where(eq(user.id, userId)).get();
		if (!u) throw new ApiError(404, 'Not found');
		const site = siteBlock(tx as unknown as Db, userId);
		if (site) throw site;
		const fates = planAccountDeletion(tx as unknown as Db, userId);
		const blocked = fates.filter((f) => f.fate === 'blocked').map((f) => f.name);
		if (blocked.length) throw new ApiError(409, blockedMessage(blocked));

		const doomed = fates.filter((f) => f.fate === 'personal' || f.fate === 'delete');
		const leaving = fates.filter((f) => f.fate === 'leave');
		result.deletedWorkspaces = doomed.map((f) => f.name);
		result.leftChapters = leaving.map((f) => f.name);

		// Studio drafts are the user's own sandbox, wherever they were made.
		const myDrafts = tx
			.select({ id: builds.id })
			.from(builds)
			.where(and(eq(builds.createdBy, userId), eq(builds.kind, 'draft')))
			.all()
			.map((b) => b.id);
		// Builds that stay need a new creator; one with nobody to inherit it is removed.
		const orphanIds: string[] = [];
		const stay = tx
			.select({ id: builds.id, orgId: builds.organizationId })
			.from(builds)
			.where(
				and(
					eq(builds.createdBy, userId),
					eq(builds.kind, 'build'),
					doomed.length
						? notInArray(
								builds.organizationId,
								doomed.map((f) => f.orgId)
							)
						: undefined
				)
			)
			.all();
		const heirOf = new Map(leaving.map((f) => [f.orgId, f.heirId!]));
		for (const b of stay) {
			let heir = heirOf.get(b.orgId);
			if (!heir) {
				// A workspace the user no longer belongs to but still has builds in: any owner, else any member.
				const rows = tx
					.select({ userId: member.userId, role: member.role })
					.from(member)
					.where(eq(member.organizationId, b.orgId))
					.orderBy(asc(member.createdAt), sql`rowid`)
					.all()
					.filter((r) => r.userId !== userId);
				heir = (rows.find((r) => normalizeRole(r.role) === 'owner') ?? rows[0])?.userId;
			}
			if (heir) tx.update(builds).set({ createdBy: heir }).where(eq(builds.id, b.id)).run();
			else orphanIds.push(b.id);
		}

		// Files must be listed while the rows still exist.
		plan = planFiles(tx as unknown as Db, {
			orgIds: doomed.map((f) => f.orgId),
			buildIds: [...myDrafts, ...orphanIds]
		});
		designIds = tx
			.select({ id: colorDesigns.id })
			.from(colorDesigns)
			.where(eq(colorDesigns.authorUserId, userId))
			.all()
			.map((d) => d.id);

		repointBuildsOffTemplates(tx as unknown as Db, plan.templateIds);
		deleteOwnedTemplates(tx as unknown as Db, plan.templateIds);
		const doomedBuilds = [...myDrafts, ...orphanIds];
		if (doomedBuilds.length) tx.delete(builds).where(inArray(builds.id, doomedBuilds)).run();
		if (doomed.length)
			tx.delete(organization)
				.where(
					inArray(
						organization.id,
						doomed.map((f) => f.orgId)
					)
				)
				.run();
		if (designIds.length)
			tx.delete(colorDesigns).where(eq(colorDesigns.authorUserId, userId)).run();

		const email = u.email.trim().toLowerCase();
		tx.delete(invitation)
			.where(or(eq(invitation.inviterId, userId), sql`lower(${invitation.email}) = ${email}`))
			.run();
		// Better Auth keeps the address (or a token naming it) as the identifier.
		tx.delete(verification)
			.where(
				or(
					sql`instr(lower(${verification.identifier}), ${email}) > 0`,
					like(verification.identifier, `%${userId}%`)
				)
			)
			.run();
		// Sessions, OAuth links and remaining memberships follow by ON DELETE CASCADE.
		tx.delete(user).where(eq(user.id, userId)).run();
	});

	await removePlannedFiles(plan);
	for (const d of designIds) await removeSnapshot(d);
	return result;
}

// ---- export

/** Largest export we build in memory, in bytes of JSON. */
export const MAX_EXPORT_BYTES = 25 * 1024 * 1024;

/**
 * The user's data as one JSON document: profile, memberships, saved designs and the builds in
 * their personal workspace (the build view minus kit data; photos by file name only).
 */
export function exportAccountData(db: Db, userId: string): string {
	const u = db.select().from(user).where(eq(user.id, userId)).get();
	if (!u) throw new ApiError(404, 'Not found');
	const orgs = db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			role: member.role,
			metadata: organization.metadata,
			joinedAt: member.createdAt
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(eq(member.userId, userId))
		.orderBy(asc(organization.name))
		.all();
	const mine = orgs.find((o) => {
		const m = parseMetadata(o.metadata);
		return m.personal === true && m.userId === userId;
	});

	const buildRows = mine
		? db
				.select({ id: builds.id, kind: builds.kind })
				.from(builds)
				.where(eq(builds.organizationId, mine.id))
				.orderBy(asc(builds.createdAt), sql`rowid`)
				.all()
		: [];
	const files = new Map<string, string>();
	if (buildRows.length)
		for (const p of db
			.select({ id: buildPhotos.id, path: buildPhotos.path })
			.from(buildPhotos)
			.where(
				inArray(
					buildPhotos.buildId,
					buildRows.map((b) => b.id)
				)
			)
			.all())
			files.set(p.id, basename(p.path));

	const exportedBuilds = buildRows.flatMap((b) => {
		const v = loadBuildView(db, b.id, userId);
		if (!v) return [];
		return [
			{
				kind: b.kind,
				build: v.build,
				filaments: v.filaments,
				variantChoices: v.variantChoices,
				state: v.state,
				plates: v.plates,
				runs: v.runs,
				activity: v.activity,
				assembly: v.assembly,
				handoff: v.handoff,
				printer: v.printer,
				photos: v.photos.map((p) => ({
					fileName: files.get(p.id) ?? null,
					kind: p.kind,
					caption: p.caption,
					createdAt: p.createdAt
				}))
			}
		];
	});

	const designs = db
		.select({
			name: colorDesigns.name,
			roles: colorDesigns.roles,
			partRoles: colorDesigns.partRoles,
			isPublic: colorDesigns.isPublic,
			createdAt: colorDesigns.createdAt
		})
		.from(colorDesigns)
		.where(eq(colorDesigns.authorUserId, userId))
		.all();
	const filamentsOwn = mine
		? db
				.select({
					brand: customFilaments.brand,
					material: customFilaments.material,
					colorName: customFilaments.colorName,
					hex: customFilaments.hex
				})
				.from(customFilaments)
				.where(eq(customFilaments.organizationId, mine.id))
				.all()
		: [];

	const json = JSON.stringify(
		{
			exportedAt: new Date().toISOString(),
			profile: {
				id: u.id,
				name: u.name,
				email: u.email,
				emailVerified: u.emailVerified,
				createdAt: u.createdAt
			},
			memberships: orgs.map((o) => ({
				name: o.id === mine?.id ? 'My builds' : o.name,
				slug: o.slug,
				role: normalizeRole(o.role),
				personal: o.id === mine?.id,
				joinedAt: o.joinedAt
			})),
			savedDesigns: designs,
			customFilaments: filamentsOwn,
			builds: exportedBuilds
		},
		null,
		2
	);
	if (Buffer.byteLength(json) > MAX_EXPORT_BYTES)
		throw new ApiError(413, 'Your data is too large to export in one file. Ask the admin.');
	return json;
}
