import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { colorDesigns, member } from '../db/schema';

export type DesignRow = typeof colorDesigns.$inferSelect;

/**
 * Who may see a design: it is public, or the viewer wrote it, or the viewer is
 * in a workspace (chapter) together with its author. Personal workspaces have a
 * single member, so they never widen access. Seeded designs have no author and
 * are public.
 */
export function canSeeDesign(db: Db, d: DesignRow, userId: string): boolean {
	if (d.isPublic || d.authorUserId === userId) return true;
	if (!d.authorUserId) return false;
	return coworkerIds(db, userId).has(d.authorUserId);
}

/** Users who share at least one workspace with `userId` (not including themselves). */
export function coworkerIds(db: Db, userId: string): Set<string> {
	const mine = db
		.select({ org: member.organizationId })
		.from(member)
		.where(eq(member.userId, userId))
		.all()
		.map((r) => r.org);
	const out = new Set<string>();
	if (!mine.length) return out;
	const mineSet = new Set(mine);
	for (const r of db.select({ org: member.organizationId, u: member.userId }).from(member).all()) {
		if (mineSet.has(r.org) && r.u !== userId) out.add(r.u);
	}
	return out;
}
