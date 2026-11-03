import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { TeamRole } from '#lib/domain/types.ts';
import { normalizeRole } from './access';
import type { Db } from './db';
import { builds, invitation, member, organization } from './db/schema';

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
