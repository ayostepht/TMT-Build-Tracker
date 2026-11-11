import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	authRequestHeaders,
	normaliseClientAddress,
	shouldWarnUndeclaredProxy,
	FORWARDED_MARKER_HEADER
} from './client-ip.ts';

describe('authRequestHeaders', () => {
	it('replaces a forged x-forwarded-for with the socket address (no proxy configured)', () => {
		const h = authRequestHeaders(
			new Headers({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7', 'user-agent': 'x' }),
			() => '192.0.2.10'
		);
		expect(h?.get('x-forwarded-for')).toBe('192.0.2.10');
		expect(h?.get('user-agent')).toBe('x');
	});
	it('adds the header when the client sent none', () => {
		expect(authRequestHeaders(new Headers(), () => '192.0.2.10')?.get('x-forwarded-for')).toBe(
			'192.0.2.10'
		);
	});
	it('uses the adapter value as one entry, never the original chain (proxy configured)', () => {
		const h = authRequestHeaders(
			new Headers({ 'x-forwarded-for': '203.0.113.5, 198.51.100.7' }),
			() => '203.0.113.5'
		);
		expect(h?.get('x-forwarded-for')).toBe('203.0.113.5');
		expect(h?.get('x-forwarded-for')).not.toContain(',');
	});
	it('accepts IPv6', () => {
		expect(authRequestHeaders(new Headers(), () => '2001:db8::1')?.get('x-forwarded-for')).toBe(
			'2001:db8::1'
		);
	});
	it('fails closed when getClientAddress throws', () => {
		const h = authRequestHeaders(new Headers({ 'x-forwarded-for': '6.6.6.6' }), () => {
			throw new Error('missing header');
		});
		expect(h).toBeNull();
	});
	it('fails closed on an address that is not an IP', () => {
		expect(authRequestHeaders(new Headers(), () => 'not-an-ip')).toBeNull();
		expect(authRequestHeaders(new Headers(), () => '1.2.3.4, 5.6.7.8')).toBeNull();
		expect(authRequestHeaders(new Headers(), () => '')).toBeNull();
	});
});

describe('zone ids and mapped addresses', () => {
	it('fails closed on a zone id', () => {
		expect(authRequestHeaders(new Headers(), () => '::1%x')).toBeNull();
		expect(authRequestHeaders(new Headers(), () => 'fe80::1%eth0')).toBeNull();
		expect(normaliseClientAddress('::1%x')).toBeNull();
	});
	it('turns an IPv4-mapped IPv6 socket address into plain IPv4', () => {
		const h = authRequestHeaders(new Headers(), () => '::ffff:203.0.113.5');
		expect(h?.get('x-forwarded-for')).toBe('203.0.113.5');
		expect(normaliseClientAddress('::FFFF:203.0.113.5')).toBe('203.0.113.5');
	});
	it('leaves other IPv6 addresses alone', () => {
		expect(normaliseClientAddress('::1')).toBe('::1');
		expect(normaliseClientAddress('2001:db8::ffff:1')).toBe('2001:db8::ffff:1');
	});
});

describe('shouldWarnUndeclaredProxy', () => {
	const marked = new Headers({ [FORWARDED_MARKER_HEADER]: '1' });
	it('warns when the preload saw forwarding headers and no proxy is trusted', () => {
		expect(shouldWarnUndeclaredProxy(marked, false, false)).toBe(true);
	});
	it('ignores forwarding headers without the marker (the preload sets x-forwarded-proto itself)', () => {
		for (const h of ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host'])
			expect(shouldWarnUndeclaredProxy(new Headers({ [h]: 'x' }), false, false)).toBe(false);
		expect(shouldWarnUndeclaredProxy(new Headers(), false, false)).toBe(false);
	});
	it('stays quiet with a trusted proxy or once warned', () => {
		expect(shouldWarnUndeclaredProxy(marked, true, false)).toBe(false);
		expect(shouldWarnUndeclaredProxy(marked, false, true)).toBe(false);
	});
});

describe('proxy-origin.mjs marker', () => {
	let server: http.Server;
	let port: number;
	beforeAll(async () => {
		delete process.env.PUBLIC_URL;
		delete process.env.BETTER_AUTH_URL;
		delete process.env.ORIGIN;
		// A variable specifier keeps this plain-JS preload out of svelte-check.
		const preload = '../../../scripts/proxy-origin.mjs';
		await import(/* @vite-ignore */ preload);
		server = http.createServer((req, res) => {
			res.end(String(req.headers[FORWARDED_MARKER_HEADER] ?? ''));
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		port = (server.address() as { port: number }).port;
	});
	afterAll(() => new Promise<void>((r) => server.close(() => r())));
	const marker = async (headers: Record<string, string>) =>
		(await fetch(`http://127.0.0.1:${port}/`, { headers })).text();

	it('is absent on a direct request', async () => {
		expect(await marker({})).toBe('');
	});
	it('is set when the client sent forwarding headers', async () => {
		expect(await marker({ 'x-forwarded-for': '203.0.113.9' })).toBe('1');
		expect(await marker({ 'x-forwarded-proto': 'https' })).toBe('1');
	});
	it('strips a client-supplied marker', async () => {
		expect(await marker({ [FORWARDED_MARKER_HEADER]: '1' })).toBe('');
	});
});
