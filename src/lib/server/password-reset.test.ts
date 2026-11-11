import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { createAuth, type Auth } from './auth';
import { openDb, runMigrations, type Db } from './db';
import { account, session as sessionTable, user, verification } from './db/schema';
import { createResetLink, parseOrigin, ResetRefused } from './password-reset';

const ENV_KEYS = [
	'BETTER_AUTH_SECRET',
	'TMT_MODE',
	'SIGNUP',
	'PUBLIC_URL',
	'BETTER_AUTH_URL',
	'ORIGIN'
];
const SECRET = '3f9c1d7a5b2e48906c1fa7d2e5b8340d9a6c2f1e7b4d8035a9c6e1f2b7d4a850';
const ORIGIN = 'http://192.0.2.10:3000';
let saved: Record<string, string | undefined>;
let db: Db;
let auth: Auth;

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) delete process.env[k];
	process.env.BETTER_AUTH_SECRET = SECRET;
	db = openDb(':memory:');
	runMigrations(db);
	auth = createAuth(db);
});
afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

const OLD = 'correct-horse-battery';
async function signUp(email = 'maker@example.com') {
	const r = await auth.api.signUpEmail({ body: { name: 'Maker', email, password: OLD } });
	return r.user.id;
}
const tokenOf = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('token')!;
const signIn = (email: string, password: string) =>
	auth.api.signInEmail({ body: { email, password } }).then(
		() => true,
		() => false
	);
const sessions = (id: string) =>
	db.select().from(sessionTable).where(eq(sessionTable.userId, id)).all().length;
const resetRows = () =>
	db.select().from(verification).where(like(verification.identifier, 'reset-password:%')).all();

describe('createResetLink', () => {
	it('happy path: link works once, old password stops, new one works', async () => {
		const id = await signUp();
		expect(await signIn('maker@example.com', OLD)).toBe(true);
		const { url, expiresAt } = await createResetLink(db, auth, 'Maker@Example.com', ORIGIN);
		expect(url.startsWith(`${ORIGIN}/reset-password#token=`)).toBe(true);
		expect(tokenOf(url)).toHaveLength(24);
		const ttl = expiresAt.getTime() - Date.now();
		expect(ttl).toBeGreaterThan(59 * 60_000);
		expect(ttl).toBeLessThanOrEqual(60 * 60_000);

		await auth.api.resetPassword({
			body: { newPassword: 'brand-new-pass-1', token: tokenOf(url) }
		});
		expect(await signIn('maker@example.com', OLD)).toBe(false);
		expect(await signIn('maker@example.com', 'brand-new-pass-1')).toBe(true);
		await expect(
			auth.api.resetPassword({ body: { newPassword: 'another-pass-22', token: tokenOf(url) } })
		).rejects.toThrow();
		expect(await signIn('maker@example.com', 'brand-new-pass-1')).toBe(true);
		expect(db.select().from(account).where(eq(account.userId, id)).all()).toHaveLength(1);
	});

	it('refuses an expired token', async () => {
		await signUp();
		const { url } = await createResetLink(db, auth, 'maker@example.com', ORIGIN);
		db.update(verification)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.run();
		await expect(
			auth.api.resetPassword({ body: { newPassword: 'brand-new-pass-1', token: tokenOf(url) } })
		).rejects.toThrow();
		expect(await signIn('maker@example.com', OLD)).toBe(true);
	});

	it('deletes older tokens when a new one is minted', async () => {
		await signUp();
		const a = await createResetLink(db, auth, 'maker@example.com', ORIGIN);
		const b = await createResetLink(db, auth, 'maker@example.com', ORIGIN);
		expect(resetRows()).toHaveLength(1);
		await expect(
			auth.api.resetPassword({ body: { newPassword: 'brand-new-pass-1', token: tokenOf(a.url) } })
		).rejects.toThrow();
		await auth.api.resetPassword({
			body: { newPassword: 'brand-new-pass-1', token: tokenOf(b.url) }
		});
	});

	it('revokes sessions at mint time and at completion', async () => {
		const id = await signUp();
		await auth.api.signInEmail({ body: { email: 'maker@example.com', password: OLD } });
		expect(sessions(id)).toBeGreaterThan(0);
		const { url } = await createResetLink(db, auth, 'maker@example.com', ORIGIN);
		expect(sessions(id)).toBe(0);
		// a session created between mint and completion is revoked by the reset itself
		await auth.api.signInEmail({ body: { email: 'maker@example.com', password: OLD } });
		expect(sessions(id)).toBeGreaterThan(0);
		await auth.api.resetPassword({
			body: { newPassword: 'brand-new-pass-1', token: tokenOf(url) }
		});
		expect(sessions(id)).toBe(0);
	});

	it('refuses an unknown email', async () => {
		await expect(createResetLink(db, auth, 'nobody@example.com', ORIGIN)).rejects.toThrow(
			ResetRefused
		);
		expect(resetRows()).toHaveLength(0);
	});

	it('refuses an SSO-only user and creates no password login', async () => {
		db.insert(user)
			.values({ id: 'u-sso', name: 'Sso', email: 'sso@example.com', emailVerified: true })
			.run();
		db.insert(account)
			.values({ id: 'a-sso', userId: 'u-sso', providerId: 'oidc', accountId: 'sub-1' })
			.run();
		await expect(createResetLink(db, auth, 'sso@example.com', ORIGIN)).rejects.toThrow(/SSO/);
		expect(resetRows()).toHaveLength(0);
		expect(db.select().from(account).where(eq(account.userId, 'u-sso')).all()).toHaveLength(1);
	});

	it('refuses in public mode', async () => {
		await signUp();
		process.env.TMT_MODE = 'public';
		await expect(createResetLink(db, auth, 'maker@example.com', ORIGIN)).rejects.toThrow(
			/Public mode/
		);
		expect(resetRows()).toHaveLength(0);
	});
});

describe('parseOrigin', () => {
	it('accepts http(s) origins', () => {
		expect(parseOrigin('http://192.0.2.10:3000')).toBe('http://192.0.2.10:3000');
		expect(parseOrigin('https://tmt.example.com/')).toBe('https://tmt.example.com');
	});
	it.each([
		'tmt.example.com',
		'ftp://x.example.com',
		'https://x.example.com/app',
		'https://x.example.com?a=1',
		'https://x.example.com#t',
		'https://user:pw@x.example.com',
		'javascript:alert(1)'
	])('rejects %s', (v) => {
		expect(() => parseOrigin(v)).toThrow(ResetRefused);
	});
});
