import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// config.ts captures NODE_ENV at import, so each test re-imports it after setting env.
async function load(vars: Record<string, string | undefined> = {}) {
	vi.resetModules();
	const keys = [
		'NODE_ENV',
		'npm_lifecycle_event',
		'ADMIN_EMAILS',
		'OIDC_ISSUER',
		'OIDC_CLIENT_ID',
		'OIDC_CLIENT_SECRET',
		'BETTER_AUTH_SECRET',
		'TMT_MODE',
		'SIGNUP',
		'GOOGLE_CLIENT_ID',
		'GOOGLE_CLIENT_SECRET',
		'GITHUB_CLIENT_ID',
		'GITHUB_CLIENT_SECRET',
		'ADDRESS_HEADER',
		'XFF_DEPTH',
		'PUBLIC_URL',
		'BETTER_AUTH_URL',
		'ORIGIN'
	];
	for (const k of keys) delete process.env[k];
	for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
	return import('./config.ts');
}

const saved = { ...process.env };
beforeEach(() => {
	process.env = { ...saved };
});
afterEach(() => {
	process.env = { ...saved };
});

const GOOD_SECRET = 'a3f1c9d2e47b58061f2a9c3d7e8b4a50c1d2e3f4a5b6c7d8e9f00112233445566';

describe('appMode', () => {
	it('defaults to selfhost', async () => {
		const c = await load();
		expect(c.appMode()).toBe('selfhost');
		expect(c.isPublicMode()).toBe(false);
	});
	it('accepts public', async () => {
		const c = await load({ TMT_MODE: 'public' });
		expect(c.appMode()).toBe('public');
		expect(c.isPublicMode()).toBe(true);
	});
	it('throws on an unknown value', async () => {
		const c = await load({ TMT_MODE: 'hosted' });
		expect(() => c.appMode()).toThrow(/TMT_MODE/);
	});
});

describe('signupMode', () => {
	it('defaults to open and accepts the three values', async () => {
		expect((await load()).signupMode()).toBe('open');
		expect((await load({ SIGNUP: 'invite' })).signupMode()).toBe('invite');
		expect((await load({ SIGNUP: 'closed' })).signupMode()).toBe('closed');
	});
	it('throws on an invalid value', async () => {
		await expect(load({ SIGNUP: 'maybe' }).then((c) => c.signupMode())).rejects.toThrow(/SIGNUP/);
	});
});

describe('socialProviders', () => {
	it('is empty when nothing is set', async () => {
		expect((await load()).socialProviders()).toEqual({});
	});
	it('returns complete pairs', async () => {
		const c = await load({
			GOOGLE_CLIENT_ID: 'gid',
			GOOGLE_CLIENT_SECRET: 'gsec',
			GITHUB_CLIENT_ID: 'hid',
			GITHUB_CLIENT_SECRET: 'hsec'
		});
		expect(c.socialProviders()).toEqual({
			google: { clientId: 'gid', clientSecret: 'gsec' },
			github: { clientId: 'hid', clientSecret: 'hsec' }
		});
	});
	it('throws on a half-configured provider without leaking the value', async () => {
		const c = await load({ GITHUB_CLIENT_ID: 'hid', GOOGLE_CLIENT_SECRET: 'super-secret-value' });
		try {
			c.socialProviders();
			expect.unreachable();
		} catch (e) {
			expect((e as Error).message).toMatch(/Google/);
			expect((e as Error).message).not.toContain('super-secret-value');
		}
	});
});

describe('trustedProxy', () => {
	it('is null without ADDRESS_HEADER', async () => {
		expect((await load({ XFF_DEPTH: '2' })).trustedProxy()).toBeNull();
	});
	it('reports the header and depth', async () => {
		expect((await load({ ADDRESS_HEADER: 'X-Forwarded-For' })).trustedProxy()).toEqual({
			header: 'x-forwarded-for',
			xffDepth: 1
		});
		expect(
			(await load({ ADDRESS_HEADER: 'X-Forwarded-For', XFF_DEPTH: '2' })).trustedProxy()
		).toEqual({ header: 'x-forwarded-for', xffDepth: 2 });
	});
	it('rejects a bad depth, including values parseInt would accept', async () => {
		for (const d of ['0', '2abc', '1.5', '-1', '0x2', '1e1']) {
			const c = await load({ ADDRESS_HEADER: 'x-forwarded-for', XFF_DEPTH: d });
			expect(() => c.trustedProxy()).toThrow(/XFF_DEPTH/);
		}
	});
});

describe('publicUrl', () => {
	it('names the variable and never echoes credentials', async () => {
		const c = await load({ BETTER_AUTH_URL: 'ftp://user:hunter2@tmt.example.com' });
		try {
			c.publicUrl();
			expect.unreachable();
		} catch (e) {
			expect((e as Error).message).toContain('BETTER_AUTH_URL');
			expect((e as Error).message).not.toContain('hunter2');
		}
		const bad = await load({ PUBLIC_URL: 'https://user:hunter2@' });
		try {
			bad.publicUrl();
			expect.unreachable();
		} catch (e) {
			expect((e as Error).message).not.toContain('hunter2');
		}
	});
});

const PUBLIC_OK = {
	TMT_MODE: 'public',
	PUBLIC_URL: 'https://tmt.example.com',
	GOOGLE_CLIENT_ID: 'a',
	GOOGLE_CLIENT_SECRET: 'b',
	ADDRESS_HEADER: 'X-Forwarded-For',
	ADMIN_EMAILS: 'admin@example.com'
};

describe('validatePublicMode', () => {
	it('is empty outside public mode', async () => {
		expect((await load()).validatePublicMode()).toEqual([]);
	});
	it('lists every problem when nothing is set', async () => {
		const p = (await load({ TMT_MODE: 'public' })).validatePublicMode();
		expect(p.join('\n')).toMatch(/PUBLIC_URL must be set/);
		expect(p.join('\n')).toMatch(/GOOGLE_CLIENT_ID/);
		expect(p.join('\n')).toMatch(/trusted reverse proxy/);
		expect(p.join('\n')).toMatch(/ADMIN_EMAILS/);
	});
	it('is clean with everything set', async () => {
		expect((await load(PUBLIC_OK)).validatePublicMode()).toEqual([]);
	});
	it('requires https and names the variable the origin came from', async () => {
		const { PUBLIC_URL: _drop, ...rest } = PUBLIC_OK;
		void _drop;
		const p = (await load({ ...rest, ORIGIN: 'http://tmt.example.com' })).validatePublicMode();
		expect(p).toEqual(['ORIGIN must be an https:// address in public mode.']);
	});
	it('rejects credentials, a path, localhost and IP literals', async () => {
		const cases: [string, RegExp][] = [
			['https://user:pw@tmt.example.com', /user name or password/],
			['https://tmt.example.com/app', /without a path/],
			['https://localhost', /localhost/],
			['https://app.localhost', /localhost/],
			['https://192.0.2.1', /IP address/],
			['https://[2001:db8::1]', /IP address/]
		];
		for (const [url, re] of cases) {
			const p = (await load({ ...PUBLIC_OK, PUBLIC_URL: url })).validatePublicMode();
			expect(p.join('\n')).toMatch(re);
			expect(p.join('\n')).not.toContain('pw@');
		}
	});
	it('allows a trailing slash', async () => {
		const c = await load({ ...PUBLIC_OK, PUBLIC_URL: 'https://tmt.example.com/' });
		expect(c.validatePublicMode()).toEqual([]);
	});
	it('rejects generic OIDC', async () => {
		const p = (
			await load({ ...PUBLIC_OK, OIDC_ISSUER: 'https://sso.example.com' })
		).validatePublicMode();
		expect(p).toHaveLength(1);
		expect(p[0]).toMatch(/OIDC/);
	});
	it('requires a trusted proxy and an admin', async () => {
		const { ADDRESS_HEADER: _a, ...noProxy } = PUBLIC_OK;
		void _a;
		expect((await load(noProxy)).validatePublicMode()[0]).toMatch(/trusted reverse proxy/);
		const { ADMIN_EMAILS: _b, ...noAdmin } = PUBLIC_OK;
		void _b;
		expect((await load(noAdmin)).validatePublicMode()[0]).toMatch(/ADMIN_EMAILS/);
	});
	it('reports a half-configured provider and a bad depth as problems instead of throwing', async () => {
		const p = (
			await load({ ...PUBLIC_OK, GOOGLE_CLIENT_SECRET: undefined, XFF_DEPTH: 'x' })
		).validatePublicMode();
		expect(p.join('\n')).toMatch(/half configured/);
		expect(p.join('\n')).toMatch(/XFF_DEPTH/);
	});
});

describe('authSecret', () => {
	const prod = { NODE_ENV: 'production' };
	it('uses the dev fallback only for NODE_ENV development or test', async () => {
		expect((await load({ NODE_ENV: 'development' })).authSecret()).toContain('dev-only');
		expect((await load({ NODE_ENV: 'test' })).authSecret()).toContain('dev-only');
		expect((await load({ NODE_ENV: 'test', BETTER_AUTH_SECRET: 'short' })).authSecret()).toBe(
			'short'
		);
	});
	it('is enforced when NODE_ENV is unset or anything else', async () => {
		await expect(load().then((c) => c.authSecret())).rejects.toThrow(/openssl rand -hex 32/);
		await expect(load({ NODE_ENV: 'staging' }).then((c) => c.authSecret())).rejects.toThrow();
	});
	it('has no build exemption', async () => {
		const c = await load({ ...prod, npm_lifecycle_event: 'build' });
		expect(() => c.authSecret()).toThrow();
		const d = await load({ npm_lifecycle_event: 'build' });
		expect(() => d.authSecret()).toThrow();
	});
	it('is always enforced in public mode, even in development', async () => {
		const c = await load({ NODE_ENV: 'development', TMT_MODE: 'public' });
		expect(() => c.authSecret()).toThrow();
	});
	it('rejects a short secret without echoing it', async () => {
		const c = await load({ ...prod, BETTER_AUTH_SECRET: 'tooshortvalue' });
		expect(() => c.authSecret()).toThrow(/too short/);
		try {
			c.authSecret();
		} catch (e) {
			expect((e as Error).message).not.toContain('tooshortvalue');
		}
	});
	it('measures the trimmed length', async () => {
		const padded = `   ${'ab'.repeat(5)}          `;
		const c = await load({ ...prod, BETTER_AUTH_SECRET: padded });
		expect(() => c.authSecret()).toThrow(/too short/);
	});
	it('requires enough distinct characters', async () => {
		const c = await load({ ...prod, BETTER_AUTH_SECRET: 'abababababababababababababababababab' });
		expect(() => c.authSecret()).toThrow(/distinct/);
		const d = await load({ ...prod, BETTER_AUTH_SECRET: 'a'.repeat(64) });
		expect(() => d.authSecret()).toThrow(/distinct/);
	});
	it('rejects obvious placeholders', async () => {
		const values = [
			'dev-only-insecure-secret-change-me-0123456789',
			'changechangechangechangechangechange',
			'passwordpasswordpasswordpassword',
			'your-secret-goes-here-0123456789abcdef',
			'replace-me-with-a-real-secret-0123456789',
			'example-secret-0123456789abcdefghijklmn',
			'CHANGE_ME_CHANGE_ME_CHANGE_ME_CHANGE_ME'
		];
		for (const v of values) {
			const c = await load({ ...prod, BETTER_AUTH_SECRET: v });
			expect(() => c.authSecret(), v).toThrow(/placeholder/);
		}
	});
	it('accepts 32+ random characters', async () => {
		const c = await load({ ...prod, BETTER_AUTH_SECRET: GOOD_SECRET });
		expect(c.authSecret()).toBe(GOOD_SECRET);
	});
	it('accepts the e2e web server secret', async () => {
		const c = await load({
			...prod,
			BETTER_AUTH_SECRET: 'e2e-secret-not-for-production-0123456789abcdef'
		});
		expect(c.authSecret()).toMatch(/^e2e-secret/);
	});
});

describe('bootProblems', () => {
	it('is empty in development without a secret', async () => {
		expect((await load({ NODE_ENV: 'development' })).bootProblems()).toEqual([]);
	});
	it('reports a missing secret when NODE_ENV is unset, without echoing', async () => {
		const p = (await load()).bootProblems();
		expect(p).toHaveLength(1);
		expect(p[0]).toMatch(/BETTER_AUTH_SECRET/);
	});
	it('never contains the secret', async () => {
		const p = (await load({ BETTER_AUTH_SECRET: 'change-me' })).bootProblems();
		expect(p.length).toBeGreaterThan(0);
		expect(p.join('\n')).not.toContain('change-me');
	});
	it('is empty with a strong secret', async () => {
		expect((await load({ BETTER_AUTH_SECRET: GOOD_SECRET })).bootProblems()).toEqual([]);
	});
	it('lists public-mode problems alongside the secret', async () => {
		const p = (await load({ TMT_MODE: 'public' })).bootProblems();
		expect(p.length).toBeGreaterThanOrEqual(5);
	});
	it('reports invalid mode, signup and depth values', async () => {
		expect(
			(await load({ TMT_MODE: 'x', BETTER_AUTH_SECRET: GOOD_SECRET })).bootProblems()[0]
		).toMatch(/TMT_MODE/);
		const p = (
			await load({
				BETTER_AUTH_SECRET: GOOD_SECRET,
				SIGNUP: 'maybe',
				ADDRESS_HEADER: 'x-forwarded-for',
				XFF_DEPTH: '2abc'
			})
		).bootProblems();
		expect(p.join('\n')).toMatch(/SIGNUP/);
		expect(p.join('\n')).toMatch(/XFF_DEPTH/);
	});
});
