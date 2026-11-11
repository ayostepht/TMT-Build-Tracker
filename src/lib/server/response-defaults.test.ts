import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installResponseDefaults, responseDefaults } from '../../../scripts/response-defaults.mjs';
import { securityHeaders } from './security-headers.ts';

describe('responseDefaults', () => {
	it('matches securityHeaders() for the headers both define', () => {
		const cases = [
			{ pathname: '/', https: true, contentType: 'text/html', status: 200 },
			{ pathname: '/invite/x', https: false, contentType: null, status: 404 },
			{ pathname: '/api/foo', https: true, contentType: 'application/json', status: 500 }
		];
		for (const c of cases) {
			const a = responseDefaults(c);
			const b = securityHeaders({ ...c, hasCsp: false });
			for (const k of Object.keys(b)) expect(a[k], `${k} for ${c.pathname}`).toBe(b[k]);
		}
	});

	it('gives successful static scripts no CSP (a service worker takes its CSP from its own response)', () => {
		const h = responseDefaults({
			pathname: '/service-worker.js',
			https: false,
			contentType: 'text/javascript',
			status: 200
		});
		expect(h['content-security-policy']).toBeUndefined();
		expect(h['x-content-type-options']).toBe('nosniff');
		expect(h['cache-control']).toBe('no-cache');
	});

	it('revalidates the PWA files but leaves other paths to their own cache headers', () => {
		const get = (pathname: string) =>
			responseDefaults({ pathname, https: false, contentType: 'text/plain', status: 200 });
		expect(get('/manifest.webmanifest')['cache-control']).toBe('no-cache');
		expect(get('/offline.html')['cache-control']).toBe('no-cache');
		expect(get('/_app/immutable/a.js')['cache-control']).toBeUndefined();
	});
});

describe('installResponseDefaults on a real server', () => {
	let server: http.Server;
	let base: string;
	beforeAll(async () => {
		installResponseDefaults(http.ServerResponse.prototype);
		server = http.createServer((req, res) => {
			if (req.url === '/_app/immutable/a.css') {
				res.writeHead(200, { 'content-type': 'text/css' });
				res.end('a{}');
			} else if (req.url === '/page') {
				res.writeHead(200, {
					'content-type': 'text/html',
					'content-security-policy': "default-src 'self'; script-src 'nonce-x'"
				});
				res.end('<p>x</p>');
			} else if (req.url === '/boom') {
				res.writeHead(500, { 'content-type': 'text/plain' });
				res.end('boom');
			} else {
				res.statusCode = 413;
				res.end('too big');
			}
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	afterAll(() => new Promise<void>((r) => server.close(() => r())));

	it('adds nosniff and friends to a static asset, no CSP', async () => {
		const res = await fetch(`${base}/_app/immutable/a.css`);
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
		expect(res.headers.get('referrer-policy')).toBeTruthy();
		expect(res.headers.get('content-security-policy')).toBeNull();
		expect(res.headers.get('strict-transport-security')).toBeNull();
	});

	it('sends HSTS when the proxy said https', async () => {
		const res = await fetch(`${base}/_app/immutable/a.css`, {
			headers: { 'x-forwarded-proto': 'https' }
		});
		expect(res.headers.get('strict-transport-security')).toBe('max-age=15552000');
	});

	it('never replaces a header the app already set', async () => {
		const res = await fetch(`${base}/page`);
		expect(res.headers.get('content-security-policy')).toContain("'nonce-x'");
		expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
	});

	it('covers error responses: 500 and an implicit-header 413', async () => {
		for (const [path, status] of [
			['/boom', 500],
			['/other', 413]
		] as const) {
			const res = await fetch(`${base}${path}`);
			expect(res.status).toBe(status);
			expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
			expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		}
	});
});
