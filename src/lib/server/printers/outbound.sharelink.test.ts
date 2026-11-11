import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapters } from './adapters';
import {
	guardedFetch,
	isGlobalUnicast,
	OutboundError,
	resolveAllowed,
	setResolver
} from './outbound';
import type { PrinterStatus } from '#lib/printers/status.ts';

// Made-up token: never a real link, and nothing here opens a real socket.
const HOST = 'shared-testtoken12345678.octoeverywhere.com';
const PUBLIC4 = '93.184.216.34';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	setResolver(null);
});

const fake = (map: Record<string, string[]>) => async (h: string) => {
	if (!map[h]) throw new Error('ENOTFOUND');
	return map[h];
};

describe('the shared-link host is the one public destination', () => {
	it('passes when every answer is global unicast, and pins one of them', async () => {
		const t = await resolveAllowed(HOST, fake({ [HOST]: ['2606:4700::1111', PUBLIC4, '8.8.8.8'] }));
		expect(t).toMatchObject({
			host: HOST,
			ip: PUBLIC4,
			family: 4,
			shareLink: true,
			literal: false
		});
		const v6 = await resolveAllowed(HOST, fake({ [HOST]: ['2606:4700::1111'] }));
		expect(v6).toMatchObject({ ip: '2606:4700::1111', family: 6 });
	});

	it.each([
		['10.0.0.1'],
		['127.0.0.1'],
		['169.254.169.254'],
		['192.168.1.5'],
		['100.64.0.9'],
		['fd00::5'],
		['fe80::1'],
		['::1'],
		['::ffff:10.0.0.1'],
		['0.0.0.0']
	])('refuses a link name that resolves to %s', async (ip) => {
		await expect(resolveAllowed(HOST, fake({ [HOST]: [ip] }))).rejects.toBeInstanceOf(
			OutboundError
		);
	});

	it('refuses the host when ANY answer is not public', async () => {
		for (const bad of ['10.0.0.1', '169.254.169.254', '127.0.0.1']) {
			await expect(resolveAllowed(HOST, fake({ [HOST]: [PUBLIC4, bad] }))).rejects.toThrow(
				/public address/
			);
		}
	});

	it('an ordinary host with a public address is still refused', async () => {
		await expect(
			resolveAllowed('printer.example.com', fake({ 'printer.example.com': [PUBLIC4] }))
		).rejects.toThrow(/not on your local network/);
		// look-alikes of the link shape are ordinary hosts too
		for (const h of [
			'shared-short.octoeverywhere.com',
			'octoeverywhere.com',
			`evil.${HOST}`,
			`${HOST}.evil.example`
		])
			await expect(resolveAllowed(h, fake({ [h]: [PUBLIC4] }))).rejects.toBeInstanceOf(
				OutboundError
			);
	});

	it('public mode refuses the share host before any DNS', async () => {
		vi.stubEnv('TMT_MODE', 'public');
		const dns = vi.fn(async () => [PUBLIC4]);
		await expect(resolveAllowed(HOST, dns)).rejects.toMatchObject({ kind: 'public' });
		expect(dns).not.toHaveBeenCalled();
		await expect(guardedFetch(`https://${HOST}/video`)).rejects.toMatchObject({ kind: 'public' });
	});

	it('guardedFetch needs https and the default port on the share host', async () => {
		const dns = vi.fn(async () => [PUBLIC4]);
		setResolver(dns);
		await expect(guardedFetch(`http://${HOST}/video`)).rejects.toThrow(/https on the default port/);
		await expect(guardedFetch(`https://${HOST}:8443/video`)).rejects.toThrow(
			/https on the default port/
		);
		await expect(guardedFetch(`http://${HOST}:80/video`)).rejects.toBeInstanceOf(OutboundError);
		expect(dns).not.toHaveBeenCalled(); // refused before any lookup or connection
	});

	it('global unicast: only the public internet', () => {
		for (const ok of [PUBLIC4, '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8'])
			expect(isGlobalUnicast(ok), ok).toBe(true);
		for (const no of [
			'10.1.1.1',
			'172.16.0.1',
			'192.168.0.1',
			'127.0.0.1',
			'169.254.1.1',
			'100.64.0.1',
			'224.0.0.1',
			'192.0.2.1',
			'198.18.0.1',
			'fc00::1',
			'fe80::1',
			'::1',
			'2001:db8::1',
			'2002::1',
			'64:ff9b::808:808',
			'nonsense'
		])
			expect(isGlobalUnicast(no), no).toBe(false);
	});
});

describe('the status websocket in link mode is validated before it is dialled', () => {
	const cfg = (secrets: Record<string, string>) => ({
		id: 'p',
		kind: 'elegoo-sdcp' as const,
		host: 'octoeverywhere',
		port: null,
		secrets
	});

	it('a link name that resolves privately is never dialled, and reports the refusal', async () => {
		const urls: string[] = [];
		vi.stubGlobal(
			'WebSocket',
			class {
				constructor(u: string) {
					urls.push(u);
				}
				close() {}
			}
		);
		setResolver(fake({ [HOST]: ['169.254.169.254'] }));
		const h = adapters['elegoo-sdcp'](cfg({ shareLink: `https://${HOST}` }));
		const seen: PrinterStatus[] = [];
		h.status$((s) => seen.push(s));
		await vi.waitFor(() => expect(seen.some((s) => s.state === 'error')).toBe(true));
		h.close();
		expect(urls).toEqual([]);
	});

	it('public mode never dials the link', async () => {
		vi.stubEnv('TMT_MODE', 'public');
		const urls: string[] = [];
		vi.stubGlobal(
			'WebSocket',
			class {
				constructor(u: string) {
					urls.push(u);
				}
				close() {}
			}
		);
		setResolver(async () => {
			throw new Error('no DNS in public mode');
		});
		const h = adapters['elegoo-sdcp'](cfg({ shareLink: `https://${HOST}` }));
		await new Promise((r) => setTimeout(r, 50));
		h.close();
		expect(urls).toEqual([]);
	});

	it('a public answer is dialled at wss://<link>/websocket (validated, not pinned)', async () => {
		const urls: string[] = [];
		vi.stubGlobal(
			'WebSocket',
			class {
				constructor(u: string) {
					urls.push(u);
				}
				close() {}
			}
		);
		setResolver(fake({ [HOST]: [PUBLIC4] }));
		const h = adapters['elegoo-sdcp'](cfg({ shareLink: `https://${HOST}` }));
		await vi.waitFor(() => expect(urls.length).toBe(1));
		h.close();
		expect(urls).toEqual([`wss://${HOST}/websocket`]);
	});
});
