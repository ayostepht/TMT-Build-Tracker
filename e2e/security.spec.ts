import { expect, test } from './fixtures';

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
