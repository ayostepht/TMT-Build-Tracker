import { describe, expect, it } from 'vitest';
import { API_CSP, HSTS, LOCKDOWN_CSP, securityHeaders, withHeaders } from './security-headers.ts';

const ctx = (o: Partial<Parameters<typeof securityHeaders>[0]> = {}) =>
	securityHeaders({
		pathname: '/',
		https: false,
		contentType: 'text/html; charset=utf-8',
		hasCsp: true,
		...o
	});

describe('securityHeaders', () => {
	it('always sends nosniff, frame protection, referrer and permissions policies', () => {
		const h = ctx();
		expect(h['x-content-type-options']).toBe('nosniff');
		expect(h['x-frame-options']).toBe('DENY');
		expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
		expect(h['permissions-policy']).toContain('camera=()');
		expect(h['permissions-policy']).toContain('microphone=()');
		expect(h['permissions-policy']).toContain('geolocation=()');
		expect(h['permissions-policy']).not.toContain('clipboard');
	});

	it('sends HSTS only on https, without includeSubDomains or preload', () => {
		expect(ctx()['strict-transport-security']).toBeUndefined();
		const h = ctx({ https: true });
		expect(h['strict-transport-security']).toBe(HSTS);
		expect(HSTS).toBe('max-age=15552000');
		expect(HSTS).not.toMatch(/includeSubDomains|preload/i);
	});

	it('sends no Referer from URLs that carry a bearer id or token', () => {
		for (const p of ['/invite/abc', '/reset-password', '/reset-password/tok'])
			expect(ctx({ pathname: p })['referrer-policy']).toBe('no-referrer');
		expect(ctx({ pathname: '/invitees' })['referrer-policy']).toBe(
			'strict-origin-when-cross-origin'
		);
	});

	it('sets COOP on documents only', () => {
		expect(ctx()['cross-origin-opener-policy']).toBe('same-origin');
		expect(ctx({ contentType: 'application/json' })['cross-origin-opener-policy']).toBeUndefined();
	});

	it('leaves the page CSP to SvelteKit when the response has one', () => {
		expect(ctx({ pathname: '/builds/x' })['content-security-policy']).toBeUndefined();
	});

	it('locks down HTML without a CSP and non-page responses without one', () => {
		expect(ctx({ hasCsp: false })['content-security-policy']).toBe("frame-ancestors 'none'");
		expect(ctx({ hasCsp: false, contentType: 'image/png' })['content-security-policy']).toBe(
			LOCKDOWN_CSP
		);
		expect(ctx({ hasCsp: false, contentType: null })['content-security-policy']).toBe(LOCKDOWN_CSP);
	});

	it('sandboxes everything under /api/, so an upload can never run as a document', () => {
		for (const contentType of ['image/webp', 'model/gltf-binary', 'application/json', 'text/html'])
			expect(
				ctx({ pathname: '/api/builds/b/photos/p', contentType })['content-security-policy']
			).toBe(API_CSP);
		expect(API_CSP).toContain('sandbox');
		expect(API_CSP).toContain("default-src 'none'");
	});
});

describe('withHeaders', () => {
	it('sets headers on a normal response, replacing a handler value', () => {
		const res = new Response('x', { headers: { 'x-content-type-options': 'other' } });
		expect(withHeaders(res, { 'x-content-type-options': 'nosniff' })).toBe(res);
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('copies a response whose headers are immutable (a redirect)', () => {
		const res = Response.redirect('http://x/y', 302);
		const out = withHeaders(res, { 'x-frame-options': 'DENY' });
		expect(out.status).toBe(302);
		expect(out.headers.get('location')).toBe('http://x/y');
		expect(out.headers.get('x-frame-options')).toBe('DENY');
	});

	it('does not touch a streamed body', async () => {
		const res = new Response(
			new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode('hi')), c.close()) }),
			{
				headers: { 'content-type': 'text/event-stream' }
			}
		);
		expect(await withHeaders(res, { 'x-frame-options': 'DENY' }).text()).toBe('hi');
	});
});
