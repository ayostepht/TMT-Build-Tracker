import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { member } from '../db/schema';

/** Any member of the team (owners first): used to load build views for server-initiated changes. */
export function getMemberActor(db: Db, orgId: string): string | null {
	const rows = db
		.select({ userId: member.userId, role: member.role })
		.from(member)
		.where(eq(member.organizationId, orgId))
		.orderBy(asc(member.createdAt))
		.all();
	return (rows.find((r) => r.role.includes('owner')) ?? rows[0])?.userId ?? null;
}
