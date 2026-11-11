import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { isSiteAdmin, siteAdminSource } from './access';
import { deleteAccount } from './account';
import { openDb, runMigrations, type Db } from './db';
import { siteAdmin, user } from './db/schema';
import { grantSiteAdmin, listSiteAdmins, revokeSiteAdmin, searchUsers } from './site-admins';

let db: Db;
beforeEach(() => {
	for (const k of ['TMT_MODE', 'PUBLIC_URL', 'ADMIN_EMAILS', 'SIGNUP']) vi.stubEnv(k, '');
	vi.stubEnv('DATABASE_URL', ':memory:');
	db = openDb(':memory:');
	runMigrations(db);
});
afterEach(() => vi.unstubAllEnvs());

let t = 1000;
function mk(id: string, verified = true) {
	db.insert(user)
		.values({
			id,
			name: id,
			email: `${id}@example.test`,
			emailVerified: verified,
			createdAt: new Date(t++)
		})
		.run();
	return { id, email: `${id}@example.test`, emailVerified: verified };
}

describe('site admin rule', () => {
	it('first account is admin until any row exists; the granter keeps access', () => {
		const a = mk('a');
		const b = mk('b');
		expect(siteAdminSource(db, a)).toBe('first');
		expect(isSiteAdmin(db, b)).toBe(false);
		grantSiteAdmin(db, a, 'b');
		expect(siteAdminSource(db, a)).toBe('granted');
		expect(siteAdminSource(db, b)).toBe('granted');
		// a third, later account is not an admin and the first-user rule no longer applies
		const c = mk('c');
		expect(isSiteAdmin(db, c)).toBe(false);
	});

	it('ADMIN_EMAILS is additive and not revocable', () => {
		mk('a');
		const b = mk('b');
		vi.stubEnv('ADMIN_EMAILS', 'b@example.test');
		expect(siteAdminSource(db, b)).toBe('config');
		grantSiteAdmin(db, b, 'b'); // already admin: no-op
		expect(() => revokeSiteAdmin(db, b, 'b')).toThrow('server configuration');
	});

	it('an env admin revoking the last granted row really removes admin (no first-account fallback)', () => {
		mk('a');
		mk('b');
		mk('boss');
		vi.stubEnv('ADMIN_EMAILS', 'boss@example.test');
		const boss = { id: 'boss', email: 'boss@example.test' };
		// env admin has an account: the earliest account is an ordinary user
		expect(isSiteAdmin(db, { id: 'a', email: 'a@example.test' })).toBe(false);
		grantSiteAdmin(db, boss, 'b');
		revokeSiteAdmin(db, boss, 'b');
		expect(db.select().from(siteAdmin).all()).toEqual([]);
		for (const id of ['a', 'b'])
			expect(isSiteAdmin(db, { id, email: `${id}@example.test` })).toBe(false);
	});

	it('ADMIN_EMAILS naming an address with no account keeps the first account admin', () => {
		const a = mk('a');
		mk('b');
		vi.stubEnv('ADMIN_EMAILS', 'later@example.test');
		expect(siteAdminSource(db, a)).toBe('first');
		mk('later');
		expect(isSiteAdmin(db, a)).toBe(false);
	});

	it('earliest account deleting itself while an env admin exists promotes nobody', async () => {
		const a = mk('a');
		mk('b');
		mk('boss');
		vi.stubEnv('ADMIN_EMAILS', 'boss@example.test');
		await deleteAccount(db, a.id);
		expect(isSiteAdmin(db, { id: 'b', email: 'b@example.test' })).toBe(false);
		expect(listSiteAdmins(db, { id: 'boss', email: 'boss@example.test' }).map((r) => r.id)).toEqual(
			['boss']
		);
	});

	it('non-admins cannot grant, revoke, list or search', () => {
		mk('a');
		const b = mk('b');
		mk('c');
		expect(() => grantSiteAdmin(db, b, 'c')).toThrow(/Only site admins/);
		expect(() => revokeSiteAdmin(db, b, 'a')).toThrow(/Only site admins/);
		expect(() => listSiteAdmins(db, b)).toThrow(/Only site admins/);
		expect(() => searchUsers(db, b, '')).toThrow(/Only site admins/);
		try {
			searchUsers(db, b, '');
		} catch (e) {
			expect((e as { status: number }).status).toBe(403);
		}
	});

	it('cannot revoke the last admin; can revoke one of two', () => {
		const a = mk('a');
		mk('b');
		grantSiteAdmin(db, a, 'b');
		revokeSiteAdmin(db, { id: 'b', email: 'b@example.test' }, 'a');
		expect(
			db
				.select()
				.from(siteAdmin)
				.all()
				.map((r) => r.userId)
		).toEqual(['b']);
		expect(() => revokeSiteAdmin(db, { id: 'b', email: 'b@example.test' }, 'b')).toThrow(
			'at least one site admin'
		);
	});

	it('public mode: unverified email is never admin and cannot be granted', () => {
		vi.stubEnv('TMT_MODE', 'public');
		vi.stubEnv('ADMIN_EMAILS', 'boss@example.test');
		const boss = mk('boss');
		mk('lurker', false);
		expect(siteAdminSource(db, boss)).toBe('config');
		expect(() => grantSiteAdmin(db, boss, 'lurker')).toThrow(/verified/);
		// a stored grant does not count without a verified email
		db.insert(siteAdmin).values({ userId: 'lurker' }).run();
		expect(
			isSiteAdmin(db, { id: 'lurker', email: 'lurker@example.test', emailVerified: false })
		).toBe(false);
		// no first-user in public mode
		expect(isSiteAdmin(db, mk('plain'))).toBe(false);
	});

	it('hand-over then deleting the old admin leaves exactly the new admin', async () => {
		const a = mk('a');
		mk('b');
		await expect(deleteAccount(db, 'a')).rejects.toMatchObject({ code: 'last_admin' });
		grantSiteAdmin(db, a, 'b');
		await deleteAccount(db, 'a');
		const rows = db.select().from(user).all();
		expect(rows.map((r) => r.id)).toEqual(['b']);
		expect(
			db
				.select()
				.from(siteAdmin)
				.all()
				.map((r) => r.userId)
		).toEqual(['b']);
		expect(isSiteAdmin(db, { id: 'b', email: 'b@example.test' })).toBe(true);
		expect(db.select().from(siteAdmin).where(eq(siteAdmin.userId, 'a')).get()).toBeUndefined();
	});

	it('search finds by name or email, skips the actor and marks admins', () => {
		const a = mk('alice');
		mk('bob');
		grantSiteAdmin(db, a, 'bob');
		const r = searchUsers(db, a, 'BO');
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ id: 'bob', isAdmin: true });
		expect(searchUsers(db, a, '')).toHaveLength(1);
	});
});
