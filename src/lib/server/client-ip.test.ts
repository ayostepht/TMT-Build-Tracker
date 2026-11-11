import { describe, expect, it } from 'vitest';
import {
	authRequestHeaders,
	normaliseClientAddress,
	shouldWarnUndeclaredProxy
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
	const xff = new Headers({ 'x-forwarded-for': '198.51.100.7' });
	it('warns for forwarding headers without a trusted proxy', () => {
		expect(shouldWarnUndeclaredProxy(xff, false, false)).toBe(true);
		expect(
			shouldWarnUndeclaredProxy(new Headers({ 'x-forwarded-proto': 'https' }), false, false)
		).toBe(true);
		expect(shouldWarnUndeclaredProxy(new Headers({ 'x-forwarded-host': 'a' }), false, false)).toBe(
			true
		);
	});
	it('stays quiet without such headers, with a trusted proxy, or once warned', () => {
		expect(shouldWarnUndeclaredProxy(new Headers(), false, false)).toBe(false);
		expect(shouldWarnUndeclaredProxy(xff, true, false)).toBe(false);
		expect(shouldWarnUndeclaredProxy(xff, false, true)).toBe(false);
	});
});
