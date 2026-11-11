import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrinterConfig } from './types';
import { adapters } from './adapters';
import { discoverSdcp } from './discovery';
import { openUpstream, CameraError } from './camera';
import { resolveCameraSource } from './camera-source';
import {
	guardedFetch,
	hostBlockReason,
	OutboundError,
	PUBLIC_MODE_MESSAGE,
	readJsonCapped,
	resolveAllowed,
	safeText,
	setResolver
} from './outbound';
import { openDb, runMigrations } from '../db';
import { organization, user } from '../db/schema';
import { ApiError } from '../access';
import { createPrinter, parseHost, toPublic, updatePrinter } from './store';
import { testConnection } from './supervisor';
import { SpoolmanClient } from '../spoolman/client';

afterEach(() => {
	vi.unstubAllEnvs();
	setResolver(null);
});

const fake = (map: Record<string, string[]>) => async (h: string) => {
	if (!map[h]) throw new Error('ENOTFOUND');
	return map[h];
};

describe('resolveAllowed (self-hosted)', () => {
	it('accepts a name whose every answer is local, and pins one validated address', async () => {
		const t = await resolveAllowed('printer.lan', fake({ 'printer.lan': ['192.168.1.20'] }));
		expect(t).toMatchObject({ ip: '192.168.1.20', family: 4, literal: false, host: 'printer.lan' });
	});
	it('prefers IPv4 when both families answer', async () => {
		const t = await resolveAllowed('x.lan', fake({ 'x.lan': ['fd00::5', '10.0.0.5'] }));
		expect(t.ip).toBe('10.0.0.5');
	});
	it('refuses a name with one public answer among private ones', async () => {
		await expect(
			resolveAllowed('mixed.example', fake({ 'mixed.example': ['10.0.0.5', '93.184.216.34'] }))
		).rejects.toThrow(/not on your local network/);
	});
	it('refuses a name that resolves to cloud metadata, including mapped IPv6', async () => {
		await expect(
			resolveAllowed('meta.example', fake({ 'meta.example': ['169.254.169.254'] }))
		).rejects.toThrow(/never allowed/);
		await expect(
			resolveAllowed('meta6.example', fake({ 'meta6.example': ['::ffff:169.254.169.254'] }))
		).rejects.toBeInstanceOf(OutboundError);
	});
	it('a rebinding resolver (private, then public) is judged on every call and never pinned stale', async () => {
		let n = 0;
		const rebinding = async () => (n++ === 0 ? ['192.168.0.9'] : ['8.8.8.8']);
		const first = await resolveAllowed('flip.example', rebinding);
		expect(first.ip).toBe('192.168.0.9'); // the connection uses this literal
		await expect(resolveAllowed('flip.example', rebinding)).rejects.toThrow(/local network/);
	});
	it('judges IP literals without any DNS lookup', async () => {
		const never = async () => {
			throw new Error('resolver must not be called');
		};
		expect((await resolveAllowed('192.168.0.5', never)).ip).toBe('192.168.0.5');
		expect((await resolveAllowed('[::1]', never)).literal).toBe(true);
		await expect(resolveAllowed('8.8.8.8', never)).rejects.toThrow(/local network/);
		await expect(resolveAllowed('169.254.169.254.', never)).rejects.toThrow(/never allowed/);
	});
	it('odd spellings resolve through the resolver and are judged by what they become', async () => {
		// getaddrinfo turns "2852039166" into 169.254.169.254; the fake does the same.
		await expect(
			resolveAllowed('2852039166', fake({ '2852039166': ['169.254.169.254'] }))
		).rejects.toThrow(/never allowed/);
		await expect(
			resolveAllowed('0xa9fea9fe', fake({ '0xa9fea9fe': ['169.254.169.254'] }))
		).rejects.toBeInstanceOf(OutboundError);
		expect((await resolveAllowed('printer.lan.', fake({ 'printer.lan': ['10.1.1.1'] }))).host).toBe(
			'printer.lan'
		);
	});
	it('unknown names fail with a clear message', async () => {
		await expect(resolveAllowed('nope.invalid', fake({}))).rejects.toThrow(/Could not find/);
	});
});

describe('public mode refuses before any network activity', () => {
	beforeEach(() => vi.stubEnv('TMT_MODE', 'public'));
	const boom = async () => {
		throw new Error('the resolver (DNS) must not be called in public mode');
	};
	const cfg = (kind: PrinterConfig['kind']): PrinterConfig => ({
		id: 'p',
		kind,
		host: '192.168.0.5',
		port: null,
		secrets: { accessCode: 'x', serial: 'y', apiKey: 'z' }
	});

	it('resolveAllowed', async () => {
		await expect(resolveAllowed('192.168.0.5', boom)).rejects.toMatchObject({
			status: 403,
			message: PUBLIC_MODE_MESSAGE
		});
		await expect(resolveAllowed('printer.lan', boom)).rejects.toThrow(PUBLIC_MODE_MESSAGE);
	});
	it('every adapter in the registry reports the refusal and opens nothing', async () => {
		setResolver(boom);
		for (const kind of ['elegoo-sdcp', 'moonraker', 'octoprint', 'bambu-lan'] as const) {
			const h = adapters[kind](cfg(kind));
			const seen: string[] = [];
			h.status$((s) => seen.push(`${s.state}:${s.message}`));
			expect(seen, kind).toEqual([`error:${PUBLIC_MODE_MESSAGE}`]);
			h.close();
		}
	});
	it('connection test', async () => {
		const r = await testConnection(cfg('moonraker'));
		expect(r).toMatchObject({ ok: false, message: PUBLIC_MODE_MESSAGE });
	});
	it('discovery, broadcast or unicast', async () => {
		await expect(discoverSdcp()).rejects.toThrow(PUBLIC_MODE_MESSAGE);
		await expect(discoverSdcp({ target: '192.168.0.5' })).rejects.toThrow(PUBLIC_MODE_MESSAGE);
	});
	it('camera source lookup and upstream fetch', async () => {
		setResolver(boom);
		await expect(
			resolveCameraSource({
				kind: 'moonraker',
				host: '192.168.0.5',
				port: null,
				cameraUrl: null,
				cameraEnabled: true,
				secrets: {}
			})
		).rejects.toThrow(PUBLIC_MODE_MESSAGE);
		const sig = new AbortController().signal;
		await expect(
			openUpstream('http://192.168.0.5:3031/video', '192.168.0.5', sig, {
				connectTimeoutMs: 1000,
				fetchFn: guardedFetch
			})
		).rejects.toThrow(PUBLIC_MODE_MESSAGE);
	});
	it('Spoolman client', async () => {
		let called = false;
		const c = new SpoolmanClient('http://192.168.0.5:7912', 1000, (async () => {
			called = true;
			return new Response('{}');
		}) as typeof fetch);
		await expect(c.health()).rejects.toThrow(PUBLIC_MODE_MESSAGE);
		expect(called).toBe(false);
	});
	it('saving a printer is refused (pausing and renaming still work); saved rows show why', () => {
		vi.unstubAllEnvs();
		const db = openDb(':memory:');
		runMigrations(db);
		db.insert(user).values({ id: 'u1', name: 'U', email: 'u@example.test' }).run();
		db.insert(organization).values({ id: 'o', name: 'O', slug: 'o', createdAt: new Date() }).run();
		const row = createPrinter(db, 'o', 'u1', { name: 'P', kind: 'moonraker', host: '10.0.0.5' });
		vi.stubEnv('TMT_MODE', 'public');
		expect(() =>
			createPrinter(db, 'o', 'u1', { name: 'Q', kind: 'moonraker', host: '10.0.0.6' })
		).toThrow(ApiError);
		expect(() => updatePrinter(db, row.id, 'o', { host: '10.0.0.9' })).toThrow(PUBLIC_MODE_MESSAGE);
		expect(() => updatePrinter(db, row.id, 'o', { enabled: true })).toThrow(ApiError);
		expect(updatePrinter(db, row.id, 'o', { enabled: false, name: 'R' }).enabled).toBe(false);
		expect(toPublic(row).blocked).toBe(PUBLIC_MODE_MESSAGE);
	});
});

describe('self-hosted save-time checks and saved rows', () => {
	it('refuses public and link-local IP literals; names and private literals pass', () => {
		expect(() => parseHost('8.8.8.8')).toThrow(/local network/);
		expect(() => parseHost('169.254.169.254')).toThrow(ApiError);
		expect(() => parseHost('::ffff:169.254.169.254')).toThrow(ApiError);
		expect(parseHost('192.168.0.5')).toBe('192.168.0.5');
		expect(parseHost('printer.lan')).toBe('printer.lan');
		expect(hostBlockReason('printer.lan')).toBeNull();
		expect(hostBlockReason('1.1.1.1')).toMatch(/local network/);
	});
	it('a row saved before the guard shows as blocked instead of crashing', () => {
		const db = openDb(':memory:');
		runMigrations(db);
		db.insert(user).values({ id: 'u1', name: 'U', email: 'u@example.test' }).run();
		db.insert(organization).values({ id: 'o', name: 'O', slug: 'o', createdAt: new Date() }).run();
		const row = createPrinter(db, 'o', 'u1', { name: 'P', kind: 'octoprint', host: '10.0.0.5' });
		const old = { ...row, host: '8.8.8.8' };
		expect(toPublic(old).blocked).toMatch(/local network/);
		expect(toPublic(row).blocked).toBeNull();
	});
	it('an adapter pointed at a refused host reports an error status and does not throw', async () => {
		const h = adapters.octoprint({
			id: 'p',
			kind: 'octoprint',
			host: '8.8.8.8',
			port: 80,
			secrets: { apiKey: 'k' }
		});
		const seen: { state: string; message?: string }[] = [];
		h.status$((s) => seen.push(s));
		await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
		expect(seen[0].state).toBe('error');
		expect(seen[0].message).toMatch(/local network/);
		h.close();
	});
});

describe('guardedFetch', () => {
	let srv: Server;
	let port = 0;
	let hits: { host?: string; key?: string; url?: string }[] = [];
	beforeEach(async () => {
		hits = [];
		srv = createServer((req: IncomingMessage, res) => {
			hits.push({
				host: req.headers.host,
				key: String(req.headers['x-api-key'] ?? ''),
				url: req.url
			});
			if (req.url?.startsWith('/redirect')) {
				res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end();
			} else if (req.url?.startsWith('/big')) {
				res.writeHead(200).end('x'.repeat(2000));
			} else res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
		});
		await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
		port = (srv.address() as AddressInfo).port;
	});
	afterEach(() => new Promise<void>((r) => srv.close(() => r())));

	it('connects to the validated address and keeps the name in the Host header', async () => {
		setResolver(fake({ 'printer.lan': ['127.0.0.1'] }));
		const res = await guardedFetch(`http://printer.lan:${port}/api/job`, {
			headers: { 'x-api-key': 'KEY' }
		});
		expect(res.status).toBe(200);
		expect(await readJsonCapped(res)).toEqual({ ok: true });
		expect(hits[0].host).toBe(`printer.lan:${port}`);
		expect(hits[0].key).toBe('KEY');
	});
	it('does not connect at all when the name resolves outside the local network', async () => {
		setResolver(fake({ 'evil.example': ['127.0.0.1', '8.8.8.8'] }));
		await expect(guardedFetch(`http://evil.example:${port}/`)).rejects.toThrow(
			/not on your local network/
		);
		expect(hits).toHaveLength(0);
	});
	it('rebinding: the second DNS answer cannot change where a request goes', async () => {
		let n = 0;
		setResolver(async () => (n++ === 0 ? ['127.0.0.1'] : ['8.8.8.8']));
		const a = await guardedFetch(`http://flip.example:${port}/`);
		expect(a.status).toBe(200);
		await expect(guardedFetch(`http://flip.example:${port}/`)).rejects.toBeInstanceOf(
			OutboundError
		);
		expect(hits).toHaveLength(1);
	});
	it('never follows a redirect: the 3xx comes back, the target is never contacted', async () => {
		const res = await guardedFetch(`http://127.0.0.1:${port}/redirect`, {
			headers: { 'x-api-key': 'KEY' }
		});
		expect(res.status).toBe(302);
		expect(hits).toHaveLength(1); // only the original request
	});
	it('refuses non-http protocols and caps JSON bodies', async () => {
		await expect(guardedFetch('file:///etc/passwd')).rejects.toBeInstanceOf(OutboundError);
		await expect(guardedFetch('ftp://10.0.0.1/')).rejects.toBeInstanceOf(OutboundError);
		const res = await guardedFetch(`http://127.0.0.1:${port}/big`);
		await expect(readJsonCapped(res, 100)).rejects.toThrow();
	});

	describe('redirects are failures on every path', () => {
		it('camera', async () => {
			const sig = new AbortController().signal;
			const err = await openUpstream(`http://127.0.0.1:${port}/redirect`, '127.0.0.1', sig, {
				connectTimeoutMs: 2000,
				fetchFn: guardedFetch
			}).catch((e) => e);
			expect(err).toBeInstanceOf(CameraError);
			expect(String(err.message)).toMatch(/redirected/);
			expect(hits).toHaveLength(1);
		});
		it('Spoolman', async () => {
			await expect(
				new SpoolmanClient(`http://127.0.0.1:${port}/redirect`).health()
			).rejects.toThrow(/redirected/);
			expect(hits).toHaveLength(1);
		});
		it('OctoPrint (API key is not forwarded)', async () => {
			const h = adapters.octoprint({
				id: 'p',
				kind: 'octoprint',
				host: '127.0.0.1',
				port: port,
				secrets: { apiKey: 'KEY' }
			});
			// /api/job is not /redirect: use a server whose every path redirects.
			h.close();
			const srv2 = createServer((req, res) => {
				hits.push({ url: req.url, key: String(req.headers['x-api-key'] ?? '') });
				res.writeHead(307, { location: `http://127.0.0.1:${port}/leak` }).end();
			});
			await new Promise<void>((r) => srv2.listen(0, '127.0.0.1', r));
			const p2 = (srv2.address() as AddressInfo).port;
			const h2 = adapters.octoprint({
				id: 'p',
				kind: 'octoprint',
				host: '127.0.0.1',
				port: p2,
				secrets: { apiKey: 'KEY' }
			});
			const seen: { state: string; message?: string }[] = [];
			h2.status$((s) => seen.push(s));
			await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
			h2.close();
			await new Promise<void>((r) => srv2.close(() => r()));
			expect(seen[0]).toMatchObject({ state: 'error' });
			expect(seen[0].message).toMatch(/redirected/);
			expect(hits.some((x) => x.url === '/leak')).toBe(false);
		});
	});
});

describe('safeText', () => {
	it('strips control characters, collapses space and caps length', () => {
		expect(safeText('a\u0000b\r\nc\u0007d')).toBe('a b c d');
		expect(safeText('x'.repeat(500), 50)).toHaveLength(50);
		expect(safeText(42)).toBe('');
	});
});
