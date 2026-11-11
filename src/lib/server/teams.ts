import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { TeamRole } from '#lib/domain/types.ts';
import { normalizeRole } from './access';
import type { Db } from './db';
import { builds, invitation, member, organization } from './db/schema';
import { assertUnder, QuotaError, quotaLimit } from './quota';

export interface TeamSummary {
	id: string;
	name: string;
	slug: string;
	role: TeamRole;
	/** Personal workspace ("My builds"): one owner, no invitations. */
	personal: boolean;
}

/** Organization metadata is stored as a JSON string (or already parsed by an adapter). */
export function parseMetadata(raw: unknown): Record<string, unknown> {
	if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
	if (typeof raw !== 'string' || !raw) return {};
	try {
		const v = JSON.parse(raw);
		return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export function isPersonalMetadata(raw: unknown): boolean {
	return parseMetadata(raw).personal === true;
}

export function isPersonalOrg(db: Db, orgId: string): boolean {
	const row = db
		.select({ metadata: organization.metadata })
		.from(organization)
		.where(eq(organization.id, orgId))
		.get();
	return !!row && isPersonalMetadata(row.metadata);
}

export function buildCount(db: Db, orgId: string): number {
	return db
		.select({ n: sql<number>`count(*)` })
		.from(builds)
		.where(eq(builds.organizationId, orgId))
		.get()!.n;
}

type Row = TeamSummary & { owner: string | null };

function teamRows(db: Db, userId: string): Row[] {
	return db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			role: member.role,
			metadata: organization.metadata
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(eq(member.userId, userId))
		.orderBy(asc(organization.name))
		.all()
		.map(({ metadata, ...t }) => {
			const meta = parseMetadata(metadata);
			return {
				...t,
				role: normalizeRole(t.role),
				personal: meta.personal === true,
				owner: typeof meta.userId === 'string' ? meta.userId : null
			};
		});
}

function toSummary(r: Row): TeamSummary {
	return { id: r.id, name: r.name, slug: r.slug, role: r.role, personal: r.personal };
}

export function listTeams(db: Db, userId: string): TeamSummary[] {
	return teamRows(db, userId).map(toSummary);
}

/** The user's own personal workspace, if they have one. */
export function findPersonalWorkspace(db: Db, userId: string): TeamSummary | null {
	const row = teamRows(db, userId).find((t) => t.personal && t.owner === userId);
	return row ? toSummary(row) : null;
}

function uniqueSlug(db: Db, base: string): string {
	let slug = base;
	while (
		db.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug)).get()
	)
		slug = `${base.slice(0, 35)}-${crypto.randomUUID().slice(0, 4)}`;
	return slug;
}

/**
 * Create the user's personal workspace: an organization flagged `personal` in its
 * metadata, with the user as its owner. Synchronous (better-sqlite3), so the
 * check-then-insert cannot interleave with another request.
 */
export function ensurePersonalWorkspace(
	db: Db,
	u: { id: string; name: string }
): { id: string; created: boolean } {
	const existing = findPersonalWorkspace(db, u.id);
	if (existing) return { id: existing.id, created: false };
	const name = `${u.name.trim() || 'My'}'s builds`;
	const id = crypto.randomUUID();
	const now = new Date();
	db.transaction((tx) => {
		tx.insert(organization)
			.values({
				id,
				name,
				slug: uniqueSlug(tx as unknown as Db, slugify(name)),
				createdAt: now,
				metadata: JSON.stringify({ personal: true, userId: u.id })
			})
			.run();
		tx.insert(member)
			.values({
				id: crypto.randomUUID(),
				organizationId: id,
				userId: u.id,
				role: 'owner',
				createdAt: now
			})
			.run();
	});
	return { id, created: true };
}

/** Number of pending, unexpired invitations addressed to this email. */
export function pendingInvitationCount(db: Db, email: string): number {
	return db
		.select({ email: invitation.email })
		.from(invitation)
		.where(and(eq(invitation.status, 'pending'), gt(invitation.expiresAt, new Date())))
		.all()
		.filter((i) => i.email.toLowerCase() === email.toLowerCase()).length;
}

/** Only same-origin relative paths are allowed as post-login redirects. */
export function safeRedirect(v: string | null | undefined): string | null {
	return v && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') ? v : null;
}

export function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'chapter'
	);
}

// ---- chapter quotas (shared by our routes and the Better Auth organization plugin hooks)

/** Memberships of a user in real chapters (the personal workspace is not a chapter). */
function chapterRows(db: Db, userId: string) {
	return db
		.select({ orgId: member.organizationId, role: member.role, metadata: organization.metadata })
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(eq(member.userId, userId))
		.all()
		.filter((r) => !isPersonalMetadata(r.metadata));
}

/** Chapters the user created (owns). `chaptersPerUser`. */
export function countChaptersOwned(db: Db, userId: string): number {
	return chapterRows(db, userId).filter((r) => normalizeRole(r.role) === 'owner').length;
}

/** Chapters the user belongs to, created or joined. `membershipsPerUser`. */
export function countChapterMemberships(db: Db, userId: string): number {
	return chapterRows(db, userId).length;
}

export function countChapterMembers(db: Db, orgId: string): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(member)
			.where(eq(member.organizationId, orgId))
			.get()?.n ?? 0
	);
}

export function countPendingInvites(db: Db, orgId: string): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(invitation)
			.where(
				and(
					eq(invitation.organizationId, orgId),
					eq(invitation.status, 'pending'),
					gt(invitation.expiresAt, new Date())
				)
			)
			.get()?.n ?? 0
	);
}

/** How many used-up (cancelled, rejected, expired) invitations a chapter keeps. */
export const KEEP_OLD_INVITATIONS = 50;

/**
 * Durable bound for the invite/cancel loop: delete the chapter's old invitations that can no longer
 * be used (cancelled, rejected, or pending but expired) beyond the newest `keep`. Open invitations and
 * accepted ones are never touched (only pending ones are ever read by the app). Call when creating one.
 */
export function pruneOldInvitations(db: Db, orgId: string, keep = KEEP_OLD_INVITATIONS): number {
	const stale = db
		.select({ id: invitation.id })
		.from(invitation)
		.where(
			and(
				eq(invitation.organizationId, orgId),
				sql`${invitation.status} != 'accepted'`,
				sql`(${invitation.status} != 'pending' or ${invitation.expiresAt} <= ${Date.now()})`
			)
		)
		.orderBy(desc(invitation.createdAt), sql`rowid desc`)
		.limit(100000)
		.offset(keep)
		.all();
	let n = 0;
	for (const r of stale) n += db.delete(invitation).where(eq(invitation.id, r.id)).run().changes;
	return n;
}

type ChapterQuotaKey =
	'chaptersPerUser' | 'membershipsPerUser' | 'membersPerChapter' | 'pendingInvitesPerChapter';

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Sentences shown to the user (the generic quota text does not name chapters). */
const CHAPTER_SENTENCES: Record<ChapterQuotaKey, (limit: number) => string> = {
	chaptersPerUser: (l) =>
		l === 0
			? 'Chapters cannot be created on this server. Ask the admin.'
			: `You already created ${plural(l, 'chapter')}, the limit on this server. Delete one or ask the admin.`,
	membershipsPerUser: (l) =>
		l === 0
			? 'Joining chapters is not allowed on this server. Ask the admin.'
			: `You already belong to ${plural(l, 'chapter')}, the limit on this server. Leave one first or ask the admin.`,
	membersPerChapter: (l) =>
		`This chapter already has ${plural(l, 'member')}, the limit on this server. Remove someone or ask the admin.`,
	pendingInvitesPerChapter: (l) =>
		l === 0
			? 'Invitations are not allowed on this server. Ask the admin.'
			: `This chapter already has ${plural(l, 'open invitation')}, the limit on this server. Cancel one or ask the admin.`
};

function chapterQuota(db: Db, key: ChapterQuotaKey, count: () => number, userId: string): void {
	try {
		assertUnder(db, key, count, { userId });
	} catch (e) {
		if (e instanceof QuotaError) throw new QuotaError(CHAPTER_SENTENCES[key](quotaLimit(key) ?? 0));
		throw e;
	}
}

/** Throws `QuotaError` when the user may not create another chapter. */
export function assertCanCreateChapter(db: Db, userId: string): void {
	chapterQuota(db, 'chaptersPerUser', () => countChaptersOwned(db, userId), userId);
	chapterQuota(db, 'membershipsPerUser', () => countChapterMemberships(db, userId), userId);
}

/** Throws `QuotaError` when the user may not join the chapter (their own cap, then the chapter's). */
export function assertCanJoinChapter(db: Db, userId: string, orgId: string): void {
	chapterQuota(db, 'membershipsPerUser', () => countChapterMemberships(db, userId), userId);
	assertCanAddMember(db, userId, orgId);
}

/** The chapter's own size cap (`membersPerChapter`). */
export function assertCanAddMember(db: Db, userId: string, orgId: string): void {
	chapterQuota(db, 'membersPerChapter', () => countChapterMembers(db, orgId), userId);
}

/** Throws `QuotaError` when the chapter already has its limit of open invitations. */
export function assertCanInvite(db: Db, userId: string, orgId: string): void {
	chapterQuota(db, 'pendingInvitesPerChapter', () => countPendingInvites(db, orgId), userId);
}
