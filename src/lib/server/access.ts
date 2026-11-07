import { and, asc, eq, sql } from 'drizzle-orm';
import type { BuildKind, TeamRole } from '#lib/domain/types.ts';
import type { Db } from './db';
import { adminEmails } from './config';
import { builds, member, user } from './db/schema';

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export function normalizeRole(role: string | null | undefined): TeamRole {
	const first = (role ?? '').split(',')[0].trim();
	return first === 'owner' || first === 'editor' ? first : 'viewer';
}

export function canEditRole(role: TeamRole): boolean {
	return role === 'owner' || role === 'editor';
}

/** Role of the user in the organization, or null when not a member. */
export function getMemberRole(db: Db, orgId: string, userId: string): TeamRole | null {
	const row = db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
		.get();
	return row ? normalizeRole(row.role) : null;
}

/** 404 when not a member (does not leak the organization's existence). */
export function requireMember(db: Db, orgId: string, userId: string): TeamRole {
	const role = getMemberRole(db, orgId, userId);
	if (!role) throw new ApiError(404, 'Not found');
	return role;
}

export function requireEditor(db: Db, orgId: string, userId: string): TeamRole {
	const role = requireMember(db, orgId, userId);
	if (!canEditRole(role)) throw new ApiError(403, 'Your role cannot edit');
	return role;
}

export function requireOwner(db: Db, orgId: string, userId: string): TeamRole {
	const role = requireMember(db, orgId, userId);
	if (role !== 'owner') throw new ApiError(403, 'Only chapter owners can do this');
	return role;
}

/** Access to a build via its organization. Null when the build does not exist or the user is not a member. */
export function buildAccess(
	db: Db,
	buildId: string,
	userId: string
): { organizationId: string; role: TeamRole; canEdit: boolean; kind: BuildKind } | null {
	const b = db
		.select({ organizationId: builds.organizationId, kind: builds.kind })
		.from(builds)
		.where(eq(builds.id, buildId))
		.get();
	if (!b) return null;
	const role = getMemberRole(db, b.organizationId, userId);
	if (!role) return null;
	return {
		organizationId: b.organizationId,
		role,
		canEdit: canEditRole(role),
		kind: b.kind === 'draft' ? 'draft' : 'build'
	};
}

/**
 * Site admins manage install-wide things (template kits, 3D models). A site
 * admin is the earliest-created user, or anyone whose email is listed in the
 * comma-separated `ADMIN_EMAILS` env var (case-insensitive).
 */
export function isSiteAdmin(db: Db, u: { id: string; email?: string | null }): boolean {
	const email = (u.email ?? '').trim().toLowerCase();
	if (email && adminEmails().includes(email)) return true;
	const first = db
		.select({ id: user.id })
		.from(user)
		.orderBy(asc(user.createdAt), sql`rowid`)
		.limit(1)
		.get();
	return first?.id === u.id;
}

/** Guard for site-admin endpoints and pages (caller must already be signed in): 404 for everyone else (does not reveal the admin area). */
export function requireSiteAdmin(db: Db, u: { id: string; email?: string | null }): void {
	if (!isSiteAdmin(db, u)) throw new ApiError(404, 'Not found');
}
