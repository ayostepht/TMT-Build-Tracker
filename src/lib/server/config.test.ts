import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// config.ts captures NODE_ENV at import, so each test re-imports it after setting env.
async function load(vars: Record<string, string | undefined> = {}) {
	vi.resetModules();
	const keys = [
		'NODE_ENV',
		'npm_lifecycle_event',
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
	it('rejects a bad depth', async () => {
		const c = await load({ ADDRESS_HEADER: 'x-forwarded-for', XFF_DEPTH: '0' });
		expect(() => c.trustedProxy()).toThrow(/XFF_DEPTH/);
	});
});

describe('validatePublicMode', () => {
	it('is empty outside public mode', async () => {
		expect((await load()).validatePublicMode()).toEqual([]);
	});
	it('reports a missing PUBLIC_URL and no provider', async () => {
		const p = (await load({ TMT_MODE: 'public' })).validatePublicMode();
		expect(p).toHaveLength(2);
		expect(p[0]).toMatch(/PUBLIC_URL must be set/);
		expect(p[1]).toMatch(/GOOGLE_CLIENT_ID/);
	});
	it('requires https', async () => {
		const p = (
			await load({
				TMT_MODE: 'public',
				PUBLIC_URL: 'http://tmt.example.com',
				GITHUB_CLIENT_ID: 'a',
				GITHUB_CLIENT_SECRET: 'b'
			})
		).validatePublicMode();
		expect(p).toEqual(['PUBLIC_URL must be an https:// address in public mode.']);
	});
	it('is clean with https and a provider', async () => {
		const c = await load({
			TMT_MODE: 'public',
			PUBLIC_URL: 'https://tmt.example.com',
			GOOGLE_CLIENT_ID: 'a',
			GOOGLE_CLIENT_SECRET: 'b'
		});
		expect(c.validatePublicMode()).toEqual([]);
	});
	it('reports a half-configured provider as a problem instead of throwing', async () => {
		const p = (
			await load({
				TMT_MODE: 'public',
				PUBLIC_URL: 'https://tmt.example.com',
				GOOGLE_CLIENT_ID: 'a'
			})
		).validatePublicMode();
		expect(p).toHaveLength(1);
		expect(p[0]).toMatch(/half configured/);
	});
});

describe('authSecret', () => {
	const prod = { NODE_ENV: 'production' };
	it('uses the dev fallback outside production', async () => {
		expect((await load()).authSecret()).toContain('dev-only');
		expect((await load({ BETTER_AUTH_SECRET: 'short' })).authSecret()).toBe('short');
	});
	it('uses the fallback during a production build', async () => {
		const c = await load({ ...prod, npm_lifecycle_event: 'build' });
		expect(c.authSecret()).toContain('dev-only');
	});
	it('requires a secret in production and names openssl rand -hex 32', async () => {
		const c = await load(prod);
		expect(() => c.authSecret()).toThrow(/openssl rand -hex 32/);
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
	it('rejects placeholders', async () => {
		const dev = await load({
			...prod,
			BETTER_AUTH_SECRET: 'dev-only-insecure-secret-change-me-0123456789'
		});
		expect(() => dev.authSecret()).toThrow(/placeholder/);
		for (const s of ['changeme', 'change-me', 'secret', 'CHANGEME']) {
			const c = await load({ ...prod, BETTER_AUTH_SECRET: s });
			expect(() => c.authSecret()).toThrow();
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
