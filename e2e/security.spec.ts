import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { PASSWORD, uniqueEmail } from './helpers';

const DB = 'data/e2e/tmt.db';

test.describe('origin handling over plain http', () => {
	test('a cross-site form post is rejected', async ({ request }) => {
		const res = await request.post('/onboarding?/create', {
			headers: {
				origin: 'http://evil.example',
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: 'name=x'
		});
		expect(res.status()).toBe(403);
	});

	test('a cross-site auth request is rejected', async ({ request }) => {
		const res = await request.post('/api/auth/sign-in/email', {
			headers: { origin: 'http://evil.example' },
			data: { email: 'a@example.com', password: 'whatever-it-is' }
		});
		expect(res.status()).toBe(403);
	});

	test('forwarded https from a proxy is honoured', async ({ request, baseURL }) => {
		const host = new URL(baseURL as string).host;
		const res = await request.post('/onboarding?/create', {
			headers: {
				origin: `https://${host}`,
				'x-forwarded-proto': 'https',
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: 'name=x',
			maxRedirects: 0
		});
		// Past the CSRF check: not signed in, so the app redirects to login instead of 403.
		expect(res.status()).not.toBe(403);
	});
});

test.describe('sessions and rate limits', () => {
	test('a session row stores the user agent but no IP address', async ({ request, baseURL }) => {
		test.skip(!!process.env.E2E_BASE_URL, 'reads the local e2e database file');
		const email = uniqueEmail('noip');
		const headers = { 'user-agent': 'e2e-session-check/1.0', origin: new URL(baseURL!).origin };
		const up = await request.post('/api/auth/sign-up/email', {
			headers,
			data: { name: 'No Ip', email, password: PASSWORD }
		});
		expect(up.ok()).toBe(true);
		const inn = await request.post('/api/auth/sign-in/email', {
			headers,
			data: { email, password: PASSWORD }
		});
		expect(inn.ok(), `sign-in ${inn.status()} ${await inn.text()}`).toBe(true);

		const db = new Database(DB, { readonly: true });
		try {
			const rows = db
				.prepare(
					'select s.ip_address as ip, s.user_agent as ua from session s join user u on u.id = s.user_id where u.email = ?'
				)
				.all(email) as { ip: string | null; ua: string | null }[];
			expect(rows.length).toBeGreaterThan(0);
			for (const r of rows) {
				expect(r.ip ?? '').toBe('');
				expect(r.ua ?? '').not.toBe('');
			}
		} finally {
			db.close();
		}
	});

	test('a burst of failed sign-ins from one client is rate limited (429)', async ({ request }) => {
		const statuses: number[] = [];
		for (let i = 0; i < 12; i++) {
			const res = await request.post('/api/auth/sign-in/email', {
				data: { email: uniqueEmail('burst'), password: 'definitely-wrong-pw' }
			});
			statuses.push(res.status());
		}
		expect(statuses, `statuses: ${statuses.join(',')}`).toContain(429);
		expect(statuses[0]).not.toBe(429);
	});
});
