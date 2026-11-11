import { describe, expect, it } from 'vitest';
import {
	classifyAddress,
	cleanHost,
	isIpLiteral,
	parseIPv4,
	parseIPv6,
	refusedMessage
} from './address';

const ok = (ip: string) => classifyAddress(ip).ok;
const why = (ip: string) => {
	const v = classifyAddress(ip);
	return v.ok ? 'ok' : v.reason;
};

describe('classifyAddress: allowed ranges', () => {
	it.each([
		'10.0.0.1',
		'10.255.255.254',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.0.249',
		'100.64.0.1',
		'100.127.255.255',
		'127.0.0.1',
		'127.255.0.3',
		'::1',
		'fc00::1',
		'fd12:3456:789a::1',
		'fe80::1',
		'febf::1',
		'[::1]',
		'fe80::1%en0'
	])('%s is on the local network', (ip) => {
		expect(ok(ip)).toBe(true);
	});
});

describe('classifyAddress: refused ranges', () => {
	it('cloud metadata and the whole link-local /16', () => {
		expect(why('169.254.169.254')).toBe('metadata');
		expect(why('169.254.0.1')).toBe('metadata');
		expect(why('169.254.255.255')).toBe('metadata');
	});
	it('metadata addresses inside the allowed private ranges (Alibaba, AWS IPv6)', () => {
		expect(why('100.100.100.200')).toBe('metadata');
		expect(why('::ffff:100.100.100.200')).toBe('metadata');
		expect(why('fd00:ec2::254')).toBe('metadata');
		expect(why('FD00:0EC2:0:0:0:0:0:254')).toBe('metadata');
		// neighbours stay allowed
		expect(ok('100.100.100.201')).toBe(true);
		expect(ok('100.100.101.200')).toBe(true);
		expect(ok('fd00:ec2::253')).toBe(true);
		expect(ok('fd00:ec3::254')).toBe(true);
	});
	it('this-network, multicast, reserved and broadcast', () => {
		expect(why('0.0.0.0')).toBe('reserved');
		expect(why('0.1.2.3')).toBe('reserved');
		expect(why('224.0.0.1')).toBe('reserved');
		expect(why('239.255.255.250')).toBe('reserved');
		expect(why('240.0.0.1')).toBe('reserved');
		expect(why('255.255.255.255')).toBe('reserved');
		expect(why('::')).toBe('reserved');
		expect(why('ff02::1')).toBe('reserved');
	});
	it('public addresses and the edges of the private ranges', () => {
		for (const ip of [
			'8.8.8.8',
			'1.1.1.1',
			'172.15.255.255',
			'172.32.0.1',
			'192.167.1.1',
			'192.169.1.1',
			'100.63.255.255',
			'100.128.0.1',
			'11.0.0.1',
			'2001:4860:4860::8888',
			'2606:4700::1111',
			'fec0::1', // site-local (deprecated), outside fe80::/10
			'64:ff9b::808:808', // NAT64 of a public address
			'2002:808:808::1' // 6to4
		])
			expect(why(ip), ip).toBe('public');
	});
	it('refuses anything that is not a literal', () => {
		expect(ok('printer.local')).toBe(false);
		expect(ok('')).toBe(false);
		expect(ok('1.2.3')).toBe(false);
		expect(ok('999.1.1.1')).toBe(false);
	});
});

describe('IPv4-mapped IPv6 is judged as the IPv4 address', () => {
	it('dotted and hex forms', () => {
		expect(ok('::ffff:192.168.0.5')).toBe(true);
		expect(ok('::ffff:c0a8:5')).toBe(true);
		expect(ok('::ffff:127.0.0.1')).toBe(true);
		expect(why('::ffff:169.254.169.254')).toBe('metadata');
		expect(why('::ffff:a9fe:a9fe')).toBe('metadata');
		expect(why('::ffff:8.8.8.8')).toBe('public');
		expect(why('::ffff:0.0.0.0')).toBe('reserved');
		expect(why('::ffff:224.0.0.1')).toBe('reserved');
		expect(why('0:0:0:0:0:ffff:a9fe:a9fe')).toBe('metadata');
	});
});

describe('odd spellings', () => {
	it('are not literals (the resolver judges what they become)', () => {
		for (const s of ['2130706433', '0x7f.0.0.1', '0177.0.0.1', '127.1', '010.0.0.1', '1.2.3.4.5'])
			expect(isIpLiteral(s), s).toBe(false);
		expect(classifyAddress('0177.0.0.1').ok).toBe(false);
	});
	it('trailing dots, brackets and case are normalised', () => {
		expect(cleanHost('Printer.Local.')).toBe('printer.local');
		expect(cleanHost('[FE80::1]')).toBe('fe80::1');
		expect(classifyAddress('169.254.169.254.').ok).toBe(false);
		expect(classifyAddress('192.168.0.1.').ok).toBe(true);
	});
	it('parses the IPv6 shapes', () => {
		expect(parseIPv6('::')).toEqual(new Array(16).fill(0));
		expect(parseIPv6('1::2')?.length).toBe(16);
		expect(parseIPv6('1:2:3:4:5:6:7:8')?.[15]).toBe(8);
		expect(parseIPv6('1:2:3:4:5:6:7')).toBeNull();
		expect(parseIPv6('1::2::3')).toBeNull();
		expect(parseIPv6('12345::1')).toBeNull();
		expect(parseIPv6('::ffff:1.2.3')).toBeNull();
		expect(parseIPv4('1.2.3.4')).toEqual([1, 2, 3, 4]);
	});
});

describe('refusedMessage', () => {
	it('tells a self-hoster what happened', () => {
		const v = classifyAddress('8.8.8.8');
		if (v.ok) throw new Error('unreachable');
		expect(refusedMessage(v, 'dns.example')).toMatch(/not on your local network/);
		const m = classifyAddress('169.254.169.254');
		if (m.ok) throw new Error('unreachable');
		expect(refusedMessage(m)).toMatch(/never allowed/);
	});
});
