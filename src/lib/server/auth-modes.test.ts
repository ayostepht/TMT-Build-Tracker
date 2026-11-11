import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleOAuthUserInfo } from 'better-auth/oauth2';
import { eq } from 'drizzle-orm';
import { createAuth, PASSWORD_PATHS, type Auth } from './auth';
import {
	decideNewUser,
	effectiveSignup,
	loginErrorMessage,
	mayUseInvitations
} from './auth-policy';
import { isSiteAdmin } from './access';
import { openDb, runMigrations, type Db } from './db';
import {
	account,
	invitation,
	member,
	organization,
	session as sessionTable,
	user
} from './db/schema';

const ENV_KEYS = [
	'BETTER_AUTH_SECRET',
	'TMT_MODE',
	'SIGNUP',
	'ADMIN_EMAILS',
	'GOOGLE_CLIENT_ID',
	'GOOGLE_CLIENT_SECRET',
	'GITHUB_CLIENT_ID',
	'GITHUB_CLIENT_SECRET',
	'OIDC_ISSUER',
	'OIDC_CLIENT_ID',
	'OIDC_CLIENT_SECRET',
	'PUBLIC_URL'
];
let saved: Record<string, string | undefined>;
let db: Db;

function setEnv(vars: Record<string, string>) {
	for (const k of ENV_KEYS) delete process.env[k];
	Object.assign(process.env, vars);
}

const PUBLIC_ENV = {
	BETTER_AUTH_SECRET: '3f9c1d7a5b2e48906c1fa7d2e5b8340d9a6c2f1e7b4d8035a9c6e1f2b7d4a850',
	TMT_MODE: 'public',
	GOOGLE_CLIENT_ID: 'g-id',
	GOOGLE_CLIENT_SECRET: 'g-secret',
	GITHUB_CLIENT_ID: 'h-id',
	GITHUB_CLIENT_SECRET: 'h-secret'
};

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	setEnv({});
	db = openDb(':memory:');
	runMigrations(db);
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

async function signUp(auth: Auth, name: string, email: string) {
	const res = await auth.api.signUpEmail({
		body: { name, email, password: 'correct-horse-battery' },
		returnHeaders: true
	});
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	return { id: res.response.user.id, headers: new Headers({ cookie }) };
}

function addInvitation(opts: {
	id: string;
	email: string;
	inviterId: string;
	orgId?: string;
	status?: string;
	expiresAt?: Date;
}) {
	const orgId = opts.orgId ?? 'org-1';
	if (!db.select().from(organization).where(eq(organization.id, orgId)).get()) {
		db.insert(organization)
			.values({ id: orgId, name: 'Chapter', slug: orgId, createdAt: new Date() })
			.run();
		db.insert(member)
			.values({
				id: `m-${orgId}`,
				organizationId: orgId,
				userId: opts.inviterId,
				role: 'owner',
				createdAt: new Date()
			})
			.run();
	}
	db.insert(invitation)
		.values({
			id: opts.id,
			organizationId: orgId,
			email: opts.email,
			role: 'editor',
			status: opts.status ?? 'pending',
			expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000),
			inviterId: opts.inviterId
		})
		.run();
}

async function oauthLogin(
	auth: Auth,
	providerId: string,
	profile: { id: string; email: string; emailVerified: boolean }
) {
	const ctx = await auth.$context;
	const c = {
		context: ctx,
		redirect: (u: string) => u,
		request: undefined,
		headers: new Headers()
	};
	return handleOAuthUserInfo(
		c as never,
		{
			userInfo: { name: 'Pat', ...profile },
			account: { providerId, accountId: profile.id },
			callbackURL: '/'
		} as never
	);
}

describe('isSiteAdmin', () => {
	const seed = () => {
		const now = new Date();
		for (const [id, email, verified] of [
			['u1', 'first@example.com', false],
			['u2', 'boss@example.com', true],
			['u3', 'raw@example.com', false]
		] as const)
			db.insert(user)
				.values({ id, name: id, email, emailVerified: verified, createdAt: now, updatedAt: now })
				.run();
	};

	it('self-hosted: ADMIN_EMAILS match (verified or not) or the earliest user', () => {
		seed();
		setEnv({ ADMIN_EMAILS: 'Boss@Example.com, raw@example.com' });
		expect(isSiteAdmin(db, { id: 'u1', email: 'first@example.com', emailVerified: false })).toBe(
			true
		);
		expect(isSiteAdmin(db, { id: 'u2', email: 'boss@example.com', emailVerified: true })).toBe(
			true
		);
		expect(isSiteAdmin(db, { id: 'u3', email: 'raw@example.com', emailVerified: false })).toBe(
			true
		);
		expect(isSiteAdmin(db, { id: 'u9', email: 'other@example.com' })).toBe(false);
	});

	it('public: only a listed AND verified email; never the earliest user', () => {
		seed();
		setEnv({ ...PUBLIC_ENV, ADMIN_EMAILS: 'boss@example.com,raw@example.com' });
		expect(isSiteAdmin(db, { id: 'u2', email: 'BOSS@example.com', emailVerified: true })).toBe(
			true
		);
		expect(isSiteAdmin(db, { id: 'u3', email: 'raw@example.com', emailVerified: false })).toBe(
			false
		);
		expect(isSiteAdmin(db, { id: 'u3', email: 'raw@example.com' })).toBe(false);
		// earliest user, not listed
		expect(isSiteAdmin(db, { id: 'u1', email: 'first@example.com', emailVerified: true })).toBe(
			false
		);
	});

	it('public with no ADMIN_EMAILS: nobody', () => {
		seed();
		setEnv(PUBLIC_ENV);
		expect(isSiteAdmin(db, { id: 'u1', email: 'first@example.com', emailVerified: true })).toBe(
			false
		);
	});
});

describe('new-user policy (SIGNUP)', () => {
	const seedUser = () => {
		const now = new Date();
		db.insert(user)
			.values({
				id: 'u1',
				name: 'Owner',
				email: 'owner@example.com',
				emailVerified: false,
				createdAt: now,
				updatedAt: now
			})
			.run();
	};
	const cfg = (signup: 'open' | 'invite' | 'closed') => ({ publicMode: false, signup });

	it('open: anyone', () => {
		seedUser();
		expect(decideNewUser(db, { email: 'new@example.com' }, cfg('open')).ok).toBe(true);
	});

	it('closed and invite: the first account on an empty database is allowed (bootstrap)', () => {
		expect(decideNewUser(db, { email: 'a@example.com' }, cfg('closed')).ok).toBe(true);
		expect(decideNewUser(db, { email: 'a@example.com' }, cfg('invite')).ok).toBe(true);
		expect(effectiveSignup(db, cfg('closed'))).toBe('open');
		seedUser();
		expect(effectiveSignup(db, cfg('closed'))).toBe('closed');
		expect(effectiveSignup(db, cfg('invite'))).toBe('invite');
	});

	it('closed: nobody after bootstrap, even with an invitation', () => {
		seedUser();
		addInvitation({ id: 'i1', email: 'new@example.com', inviterId: 'u1' });
		expect(decideNewUser(db, { email: 'new@example.com' }, cfg('closed'))).toMatchObject({
			ok: false,
			code: 'signup_closed'
		});
	});

	it('invite: only a pending, unexpired invitation for that email (case-insensitive)', () => {
		seedUser();
		addInvitation({ id: 'i1', email: 'New@Example.com', inviterId: 'u1' });
		addInvitation({
			id: 'i2',
			email: 'old@example.com',
			inviterId: 'u1',
			expiresAt: new Date(Date.now() - 1000)
		});
		addInvitation({ id: 'i3', email: 'used@example.com', inviterId: 'u1', status: 'accepted' });
		expect(decideNewUser(db, { email: 'new@example.com' }, cfg('invite')).ok).toBe(true);
		for (const e of ['old@example.com', 'used@example.com', 'nobody@example.com'])
			expect(decideNewUser(db, { email: e }, cfg('invite'))).toMatchObject({
				ok: false,
				code: 'invitation_required'
			});
	});

	it('public: verified provider email only; SIGNUP is not consulted', () => {
		const c = { publicMode: true, signup: 'closed' as const };
		expect(decideNewUser(db, { email: 'a@example.com', emailVerified: true }, c).ok).toBe(true);
		expect(decideNewUser(db, { email: 'a@example.com', emailVerified: false }, c)).toMatchObject({
			ok: false,
			code: 'email_not_verified'
		});
		expect(decideNewUser(db, { email: 'a@example.com' }, c).ok).toBe(false);
	});

	it('invitations: public mode needs a verified email, self-hosted does not', () => {
		expect(mayUseInvitations({ publicMode: true, signup: 'open' }, { emailVerified: false })).toBe(
			false
		);
		expect(mayUseInvitations({ publicMode: true, signup: 'open' }, { emailVerified: true })).toBe(
			true
		);
		expect(mayUseInvitations({ publicMode: false, signup: 'open' }, { emailVerified: false })).toBe(
			true
		);
	});

	it('login error codes map to fixed messages', () => {
		expect(loginErrorMessage(null)).toBeNull();
		expect(loginErrorMessage('email_not_found')).toMatch(/GitHub/);
		expect(loginErrorMessage('account_not_linked')).toMatch(/already exists/);
		expect(loginErrorMessage('<script>')).toBe('Sign-in did not complete. Please try again.');
	});
});

describe('self-hosted auth enforcement', () => {
	it('SIGNUP=closed: first email sign-up works, the second is refused', async () => {
		setEnv({ SIGNUP: 'closed' });
		const auth = createAuth(db);
		await signUp(auth, 'First', 'first@example.com');
		await expect(signUp(auth, 'Second', 'second@example.com')).rejects.toMatchObject({
			status: 'FORBIDDEN'
		});
		expect(db.select().from(user).all()).toHaveLength(1);
	});

	it('SIGNUP=invite: only the invited address can register', async () => {
		setEnv({ SIGNUP: 'invite' });
		const auth = createAuth(db);
		const first = await signUp(auth, 'First', 'first@example.com');
		await expect(signUp(auth, 'Nope', 'nope@example.com')).rejects.toMatchObject({
			status: 'FORBIDDEN'
		});
		addInvitation({ id: 'i1', email: 'guest@example.com', inviterId: first.id });
		const guest = await signUp(auth, 'Guest', 'guest@example.com');
		expect(guest.id).toBeTruthy();
	});

	it('SIGNUP=invite also gates a first SSO login', async () => {
		setEnv({ SIGNUP: 'invite' });
		const auth = createAuth(db);
		const first = await signUp(auth, 'First', 'first@example.com');
		await expect(
			oauthLogin(auth, 'oidc', { id: 'sso-1', email: 'stranger@example.com', emailVerified: true })
		).rejects.toMatchObject({ status: 'FORBIDDEN' });
		addInvitation({ id: 'i1', email: 'guest@example.com', inviterId: first.id });
		const ok = await oauthLogin(auth, 'oidc', {
			id: 'sso-2',
			email: 'guest@example.com',
			emailVerified: true
		});
		expect(ok.error).toBeNull();
	});

	it('an SSO login does not attach to an existing unverified password account', async () => {
		const auth = createAuth(db);
		await signUp(auth, 'Pat', 'pat@example.com');
		const res = await oauthLogin(auth, 'oidc', {
			id: 'sso-1',
			email: 'pat@example.com',
			emailVerified: true
		});
		expect(res.error).toBe('account not linked');
		expect(db.select().from(account).where(eq(account.providerId, 'oidc')).all()).toHaveLength(0);
		expect(db.select().from(user).all()).toHaveLength(1);
		// the login page turns the redirect code into a message that makes sense
		expect(loginErrorMessage(res.error!.split(' ').join('_'))).toMatch(/already exists/);
	});
});

describe('public mode auth', () => {
	it('registers Google and GitHub, not email/password or generic OIDC', async () => {
		setEnv({
			...PUBLIC_ENV,
			OIDC_ISSUER: 'https://idp.example.com',
			OIDC_CLIENT_ID: 'x',
			OIDC_CLIENT_SECRET: 'y'
		});
		const auth = createAuth(db);
		const ctx = await auth.$context;
		expect(ctx.socialProviders.map((p) => p.id).sort()).toEqual(['github', 'google']);
		expect(ctx.options.emailAndPassword?.enabled).toBe(false);
		expect(ctx.rateLimit.enabled).toBe(true);
		expect(ctx.rateLimit.storage).toBe('memory');
	});

	it('every password route answers 4xx over HTTP', async () => {
		setEnv({ ...PUBLIC_ENV });
		const auth = createAuth(db);
		const paths = [...PASSWORD_PATHS, '/reset-password/sometoken', '/verify-email?token=x'];
		for (const p of paths) {
			for (const method of ['POST', 'GET']) {
				const res = await auth.handler(
					new Request(`http://localhost:3000/api/auth${p}`, {
						method,
						headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
						body:
							method === 'POST'
								? JSON.stringify({
										email: 'a@example.com',
										password: 'correct-horse-battery',
										name: 'A'
									})
								: undefined
					})
				);
				expect(res.status, `${method} ${p}`).toBeGreaterThanOrEqual(400);
				expect(res.status, `${method} ${p}`).toBeLessThan(500);
			}
		}
		expect(db.select().from(user).all()).toHaveLength(0);
	});

	it('refuses an unverified provider email, including via a later GitHub login', async () => {
		setEnv(PUBLIC_ENV);
		const auth = createAuth(db);
		await expect(
			oauthLogin(auth, 'github', { id: 'gh-1', email: 'pat@example.com', emailVerified: false })
		).rejects.toMatchObject({ body: { code: 'email_not_verified' } });
		expect(db.select().from(user).all()).toHaveLength(0);
	});

	it('Google then GitHub on the same verified email is one user', async () => {
		setEnv(PUBLIC_ENV);
		const auth = createAuth(db);
		const a = await oauthLogin(auth, 'google', {
			id: 'g-1',
			email: 'pat@example.com',
			emailVerified: true
		});
		const b = await oauthLogin(auth, 'github', {
			id: 'gh-1',
			email: 'pat@example.com',
			emailVerified: true
		});
		expect(a.error).toBeNull();
		expect(b.error).toBeNull();
		expect(b.data?.user.id).toBe(a.data?.user.id);
		expect(db.select().from(user).all()).toHaveLength(1);
		expect(
			db
				.select()
				.from(account)
				.all()
				.map((x) => x.providerId)
				.sort()
		).toEqual(['github', 'google']);
	});

	it('GitHub with an unverified email does not attach to the Google user', async () => {
		setEnv(PUBLIC_ENV);
		const auth = createAuth(db);
		await oauthLogin(auth, 'google', { id: 'g-1', email: 'pat@example.com', emailVerified: true });
		const b = await oauthLogin(auth, 'github', {
			id: 'gh-1',
			email: 'pat@example.com',
			emailVerified: false
		});
		expect(b.error).toBe('account not linked');
		expect(db.select().from(account).all()).toHaveLength(1);
	});

	it('refuses a session for a user whose email is not verified', async () => {
		setEnv(PUBLIC_ENV);
		const auth = createAuth(db);
		const now = new Date();
		db.insert(user)
			.values({
				id: 'u1',
				name: 'U',
				email: 'u@example.com',
				emailVerified: false,
				createdAt: now,
				updatedAt: now
			})
			.run();
		const ctx = await auth.$context;
		await expect(ctx.internalAdapter.createSession('u1')).rejects.toMatchObject({
			status: 'FORBIDDEN'
		});
	});

	it('invitation acceptance needs a verified email even when called directly', async () => {
		// An unverified self-hosted account that later meets a public-mode server (e.g. a
		// migrated database): its session cookie is valid, its email is not verified.
		setEnv({ BETTER_AUTH_SECRET: PUBLIC_ENV.BETTER_AUTH_SECRET });
		const selfhost = createAuth(db);
		const pat = await signUp(selfhost, 'Pat', 'pat@example.com');
		const inviter = await signUp(selfhost, 'Inviter', 'inviter@example.com');
		addInvitation({ id: 'inv-1', email: 'pat@example.com', inviterId: inviter.id });

		setEnv(PUBLIC_ENV);
		const pub = createAuth(db);
		await expect(
			pub.api.acceptInvitation({ body: { invitationId: 'inv-1' }, headers: pat.headers })
		).rejects.toMatchObject({
			status: 'FORBIDDEN',
			body: { message: expect.stringMatching(/verif/i) }
		});
		expect(db.select().from(invitation).where(eq(invitation.id, 'inv-1')).get()?.status).toBe(
			'pending'
		);
		expect(
			db
				.select()
				.from(member)
				.where(eq(member.userId, pat.id))
				.all()
				.filter((m) => m.organizationId === 'org-1')
		).toHaveLength(0);

		// verified: accepted
		db.update(user).set({ emailVerified: true }).where(eq(user.id, pat.id)).run();
		await pub.api.acceptInvitation({ body: { invitationId: 'inv-1' }, headers: pat.headers });
		expect(db.select().from(invitation).where(eq(invitation.id, 'inv-1')).get()?.status).toBe(
			'accepted'
		);
	});
});

describe('session hook and bootstrap guard', () => {
	it('public: a session for an unverified user is refused even with an active workspace', async () => {
		setEnv(PUBLIC_ENV);
		const auth = createAuth(db);
		const ctx = await auth.$context;
		const now = new Date();
		db.insert(user)
			.values({
				id: 'u1',
				name: 'Pat',
				email: 'pat@example.com',
				emailVerified: false,
				createdAt: now,
				updatedAt: now
			})
			.run();
		await expect(
			ctx.internalAdapter.createSession('u1', false, { activeOrganizationId: 'org-x' })
		).rejects.toMatchObject({ body: { code: 'email_not_verified' } });
		expect(db.select().from(sessionTable).all()).toHaveLength(0);
	});

	it('SIGNUP=closed: two simultaneous first sign-ups create one account', async () => {
		setEnv({ SIGNUP: 'closed' });
		const auth = createAuth(db);
		const ctx = await auth.$context;
		const make = (n: string) =>
			ctx.internalAdapter.createUser({ name: n, email: `${n}@example.com`, emailVerified: false }, {
				source: 'test'
			} as never);
		const results = await Promise.allSettled([make('a'), make('b')]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(db.select().from(user).all()).toHaveLength(1);
	});
});
