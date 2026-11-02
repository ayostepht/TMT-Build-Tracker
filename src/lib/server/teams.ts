import { asc, eq } from 'drizzle-orm';
import type { TeamRole } from '#lib/domain/types.ts';
import { normalizeRole } from './access';
import type { Db } from './db';
import { member, organization } from './db/schema';

export interface TeamSummary {
	id: string;
	name: string;
	slug: string;
	role: TeamRole;
}

export function listTeams(db: Db, userId: string): TeamSummary[] {
	return db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			role: member.role
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(eq(member.userId, userId))
		.orderBy(asc(organization.name))
		.all()
		.map((t) => ({ ...t, role: normalizeRole(t.role) }));
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
