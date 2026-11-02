import { and, eq } from 'drizzle-orm';
import type { TeamRole } from '#lib/domain/types.ts';
import type { Db } from './db';
import { builds, member } from './db/schema';

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
): { organizationId: string; role: TeamRole; canEdit: boolean } | null {
	const b = db
		.select({ organizationId: builds.organizationId })
		.from(builds)
		.where(eq(builds.id, buildId))
		.get();
	if (!b) return null;
	const role = getMemberRole(db, b.organizationId, userId);
	if (!role) return null;
	return { organizationId: b.organizationId, role, canEdit: canEditRole(role) };
}
