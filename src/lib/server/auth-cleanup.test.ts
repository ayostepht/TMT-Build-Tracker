import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, runMigrations, type Db } from './db';
import { account, session, user } from './db/auth.schema';
import { cleanupAuthData, cleanupAuthDataAtStartup } from './auth-cleanup';

let db: Db;
const now = new Date();
const later = new Date(now.getTime() + 3600_000);

function addUser(id: string) {
	db.insert(user)
		.values({
			id,
			name: id,
			email: `${id}@example.invalid`,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		})
		.run();
}
function addSession(id: string, userId: string, ip: string | null) {
	db.insert(session)
		.values({ id, token: `tok-${id}`, userId, ipAddress: ip, expiresAt: later, updatedAt: now })
		.run();
}
function addAccount(
	id: string,
	userId: string,
	providerId: string,
	extra: Partial<typeof account.$inferInsert> = {}
) {
	db.insert(account)
		.values({ id, accountId: `acc-${id}`, userId, providerId, updatedAt: now, ...extra })
		.run();
}

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	addUser('u1');
	addSession('s1', 'u1', '203.0.113.7');
	addSession('s2', 'u1', '');
	addSession('s3', 'u1', null);
	addAccount('a1', 'u1', 'credential', { password: 'fake-hash' });
	addAccount('a2', 'u1', 'oidc', {
		accessToken: 'fake-token',
		refreshToken: 'fake-refresh',
		idToken: 'fake-id',
		accessTokenExpiresAt: later,
		refreshTokenExpiresAt: later,
		scope: 'openid,email'
	});
	addAccount('a3', 'u1', 'github', { accessToken: 'fake-token', idToken: 'fake-id' });
	addAccount('a4', 'u1', 'google', { idToken: 'fake-id' });
});

describe('cleanupAuthData', () => {
	it('clears IPs and tokens, keeps OIDC id token, password and scope', () => {
		expect(cleanupAuthData(db)).toEqual({ sessions: 1, accounts: 3 });
		const s = Object.fromEntries(
			db
				.select()
				.from(session)
				.all()
				.map((r) => [r.id, r.ipAddress])
		);
		expect(s).toEqual({ s1: '', s2: '', s3: null });
		const a = Object.fromEntries(
			db
				.select()
				.from(account)
				.all()
				.map((r) => [r.id, r])
		);
		expect(a.a1.password).toBe('fake-hash');
		expect(a.a2).toMatchObject({
			accessToken: null,
			refreshToken: null,
			accessTokenExpiresAt: null,
			refreshTokenExpiresAt: null,
			idToken: 'fake-id',
			scope: 'openid,email',
			providerId: 'oidc',
			accountId: 'acc-a2'
		});
		expect(a.a3).toMatchObject({ accessToken: null, idToken: null });
		expect(a.a4.idToken).toBeNull();
	});

	it('is idempotent and logs nothing the second time', () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		cleanupAuthDataAtStartup(db);
		expect(log).toHaveBeenCalledTimes(1);
		expect(log.mock.calls[0][0]).not.toMatch(/203\.0\.113|fake/);
		expect(cleanupAuthData(db)).toEqual({ sessions: 0, accounts: 0 });
		cleanupAuthDataAtStartup(db);
		expect(log).toHaveBeenCalledTimes(1);
		log.mockRestore();
	});

	it('works on empty tables and leaves other rows alone', () => {
		db.delete(user).where(eq(user.id, 'u1')).run();
		expect(cleanupAuthData(db)).toEqual({ sessions: 0, accounts: 0 });
	});
});
