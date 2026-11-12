import { describe, expect, it } from 'vitest';
import { CONNECTION_OPTIONS, connectionOptionsFor } from './connection-options.ts';
import { PRINTER_KIND_INFO, PRINTER_KINDS } from './status.ts';
import { supportsShareLink } from './share-link.ts';

describe('connection options', () => {
	it('has unique keys and covers every printer kind', () => {
		const keys = CONNECTION_OPTIONS.map((o) => o.key);
		expect(new Set(keys).size).toBe(keys.length);
		for (const k of PRINTER_KINDS) expect(CONNECTION_OPTIONS.some((o) => o.kind === k)).toBe(true);
	});

	it('only Elegoo (LAN and link) is marked verified on real hardware', () => {
		expect(
			CONNECTION_OPTIONS.filter((o) => o.verifiedOnHardware)
				.map((o) => o.key)
				.sort()
		).toEqual(['elegoo-lan', 'octoeverywhere-elegoo']);
	});

	it('link options exist exactly for the kinds that can use a link, and require the link', () => {
		const links = CONNECTION_OPTIONS.filter((o) => o.via === 'link');
		expect(links.map((o) => o.kind).sort()).toEqual(['elegoo-sdcp', 'moonraker', 'octoprint']);
		for (const o of links) {
			expect(supportsShareLink(o.kind)).toBe(true);
			const f = o.fields.find((x) => x.key === 'shareLink')!;
			expect(f).toMatchObject({ where: 'secrets', required: true, secret: true });
			expect(o.fields.some((x) => x.key === 'host')).toBe(false);
		}
		expect(supportsShareLink('bambu-lan')).toBe(false);
		expect(supportsShareLink('manual')).toBe(false);
	});

	it('secret fields agree with PRINTER_KIND_INFO', () => {
		for (const o of CONNECTION_OPTIONS) {
			const known = new Map(PRINTER_KIND_INFO[o.kind].secrets.map((s) => [s.key, s.secret]));
			for (const f of o.fields.filter((x) => x.where === 'secrets')) {
				expect(known.has(f.key)).toBe(true);
				expect(known.get(f.key)).toBe(f.secret);
			}
		}
	});

	it('manual takes no address and no secrets', () => {
		const m = CONNECTION_OPTIONS.find((o) => o.key === 'manual')!;
		expect(m.label).toBe('Not connected');
		expect(m.fields.some((f) => f.key === 'host' || f.where === 'secrets')).toBe(false);
	});

	it('hosted mode offers links and Not connected only', () => {
		const hosted = connectionOptionsFor(true);
		expect(hosted.filter((o) => o.available).map((o) => o.key)).toEqual([
			'octoeverywhere-elegoo',
			'octoeverywhere-klipper',
			'octoeverywhere-octoprint',
			'manual'
		]);
		expect(hosted.find((o) => o.key === 'elegoo-lan')!.unavailableReason).toMatch(/hosted site/);
		expect(connectionOptionsFor(false).every((o) => o.available)).toBe(true);
	});
});
