/** Who the site admins are, and the server-checked mutations that change it (rule: top of `access.ts`). */
import { asc, eq, or, sql } from 'drizzle-orm';
import { ApiError, isSiteAdmin, siteAdminSource, type SiteAdminSource } from './access';
import { isPublicMode } from './config';
import type { Db } from './db';
import { siteAdmin, user } from './db/schema';

export interface AdminActor {
	id: string;
	email?: string | null;
	emailVerified?: boolean | null;
}

export interface SiteAdminRow {
	id: string;
	name: string;
	email: string;
	source: SiteAdminSource;
}

function requireAdmin(db: Db, actor: AdminActor): void {
	if (!isSiteAdmin(db, actor)) throw new ApiError(403, 'Only site admins can do this');
}

const allUsers = (db: Db) =>
	db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified
		})
		.from(user)
		.orderBy(asc(user.name), asc(user.email))
		.all();

/** Current site admins with where their role comes from. */
export function listSiteAdmins(db: Db, actor: AdminActor): SiteAdminRow[] {
	requireAdmin(db, actor);
	const out: SiteAdminRow[] = [];
	for (const u of allUsers(db)) {
		const source = siteAdminSource(db, u);
		if (source) out.push({ id: u.id, name: u.name, email: u.email, source });
	}
	return out;
}

export const USER_LIST_LIMIT = 50;

/** Accounts matching `q` (name or email), for the hand-over picker. Site admins only. */
export function searchUsers(db: Db, actor: AdminActor, q: string) {
	requireAdmin(db, actor);
	const term = q
		.trim()
		.toLowerCase()
		.replace(/[\\%_]/g, (c) => `\\${c}`);
	const rows = db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified
		})
		.from(user)
		.where(
			term
				? or(
						sql`lower(${user.name}) like ${`%${term}%`} escape '\\'`,
						sql`lower(${user.email}) like ${`%${term}%`} escape '\\'`
					)
				: undefined
		)
		.orderBy(asc(user.name), asc(user.email))
		.limit(USER_LIST_LIMIT)
		.all();
	return rows
		.filter((r) => r.id !== actor.id)
		.map((r) => ({
			id: r.id,
			name: r.name,
			email: r.email,
			isAdmin: isSiteAdmin(db, r),
			// Public mode only grants to provider-verified emails.
			canGrant: !isPublicMode() || r.emailVerified === true
		}));
}

/**
 * Make `targetId` a site admin. When the actor is admin only by the "first account" rule, they get
 * a row too (in the same transaction), because the first row ends that rule.
 */
export function grantSiteAdmin(db: Db, actor: AdminActor, targetId: string): void {
	db.transaction((tx) => {
		const t = tx as unknown as Db;
		requireAdmin(t, actor);
		const target = tx
			.select({ id: user.id, email: user.email, emailVerified: user.emailVerified })
			.from(user)
			.where(eq(user.id, targetId))
			.get();
		if (!target) throw new ApiError(404, 'Account not found');
		if (isPublicMode() && target.emailVerified !== true)
			throw new ApiError(400, 'Only accounts with a verified email can become site admins');
		if (isSiteAdmin(t, target)) return;
		const actorSource = siteAdminSource(t, actor);
		if (actorSource === 'first')
			tx.insert(siteAdmin)
				.values({ userId: actor.id, grantedBy: actor.id })
				.onConflictDoNothing()
				.run();
		tx.insert(siteAdmin)
			.values({ userId: target.id, grantedBy: actor.id })
			.onConflictDoNothing()
			.run();
	});
}

/** Take a granted role away. Refuses the server-configured admins, the implicit first admin and the last admin. */
export function revokeSiteAdmin(db: Db, actor: AdminActor, targetId: string): void {
	db.transaction((tx) => {
		const t = tx as unknown as Db;
		requireAdmin(t, actor);
		const target = tx
			.select({ id: user.id, email: user.email, emailVerified: user.emailVerified })
			.from(user)
			.where(eq(user.id, targetId))
			.get();
		if (!target) throw new ApiError(404, 'Account not found');
		const source = siteAdminSource(t, target);
		if (source === 'config')
			throw new ApiError(400, 'This admin is set by the server configuration');
		if (source !== 'granted') throw new ApiError(400, 'This account is not a granted site admin');
		const others = allUsers(t).filter((u) => u.id !== targetId && isSiteAdmin(t, u));
		if (!others.length) throw new ApiError(409, 'There must be at least one site admin');
		tx.delete(siteAdmin).where(eq(siteAdmin.userId, targetId)).run();
	});
}
