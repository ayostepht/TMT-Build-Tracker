import { describe, expect, it } from 'vitest';
import { authRequestHeaders } from './client-ip.ts';

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
