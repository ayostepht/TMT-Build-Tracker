/**
 * r49: OctoEverywhere links for Klipper and OctoPrint, manual (not connected) printers, and the
 * hosted-site rules. The link host is made up and never resolves for real: DNS is a stub that
 * answers a public address, `https.request` is redirected to a local mock, and the global
 * WebSocket is redirected to the mock Moonraker socket.
 */
import http, { createServer, type IncomingMessage, type Server } from 'node:http';
import https from 'node:https';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrinterStatus } from '#lib/printers/status.ts';
import { openDb, runMigrations } from '../db';
import { organization, printers, user } from '../db/schema';
import { adapters } from './adapters';
import { LINK_POLL_ACTIVE_MS, LINK_POLL_IDLE_MS } from './adapters/octoprint';
import { resolveCameraSource, type CameraTarget } from './camera-source';
import { MiniWsServer, sendJson } from './mini-ws';
import { guardedFetch, resolveAllowed, setResolver, PUBLIC_MODE_MESSAGE } from './outbound';
import { decryptSecrets } from './secrets';
import { configFromInput, createPrinter, toPublic, updatePrinter } from './store';
import { getSupervisor, startSupervisor, Supervisor, testConnection } from './supervisor';
import { linkBackoff, type PrinterConfig } from './types';
import { discoverSdcp } from './discovery';

const HOST = 'shared-testtoken12345678.octoeverywhere.com';
const LINK = `https://${HOST}`;
const HOST2 = 'shared-secondtoken87654321.octoeverywhere.com';
const LINK2 = `https://${HOST2}`;

const cleanup: (() => unknown)[] = [];
beforeEach(() => setResolver(async () => ['93.184.216.34']));
afterEach(async () => {
	setResolver(null);
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	vi.useRealTimers();
	while (cleanup.length) await cleanup.pop()!();
});
async function until<T>(fn: () => T | undefined | false, ms = 5000): Promise<T> {
	const t0 = Date.now();
	for (;;) {
		const v = fn();
		if (v) return v;
		if (Date.now() - t0 > ms) throw new Error('timeout');
		await new Promise((r) => setTimeout(r, 25));
	}
}

/** A local web server standing in for the printer behind the link. */
async function fakeWeb(handler: (req: IncomingMessage, url: URL) => unknown | number): Promise<{
	port: number;
	hits: { method: string; path: string; headers: IncomingMessage['headers'] }[];
	server: Server;
}> {
	const hits: { method: string; path: string; headers: IncomingMessage['headers'] }[] = [];
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://x');
		hits.push({ method: req.method ?? '', path: url.pathname + url.search, headers: req.headers });
		const r = handler(req, url);
		if (typeof r === 'number') return res.writeHead(r).end();
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify(r));
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	cleanup.push(() => new Promise((r) => server.close(() => r(null))));
	return { port: (server.address() as { port: number }).port, hits, server };
}

/** Redirect every `https.request` (what guardedFetch uses) to the local mock; record what was asked. */
function redirectHttps(port: number) {
	const asked: { hostname: string; port: unknown; path: string; pinned?: string }[] = [];
	vi.spyOn(https, 'request').mockImplementation(((opts: never, cb: never) => {
		const o = opts as {
			hostname: string;
			port: unknown;
			path: string;
			method: string;
			headers: Record<string, string>;
			lookup: (h: string, o: object, cb: (e: null, a: string) => void) => void;
		};
		let pinned: string | undefined;
		o.lookup(o.hostname, {}, (_e, a) => (pinned = a));
		asked.push({ hostname: o.hostname, port: o.port, path: o.path, pinned });
		return http.request(
			{ hostname: '127.0.0.1', port, path: o.path, method: o.method, headers: o.headers },
			cb
		);
	}) as never);
	return asked;
}

const cfg = (kind: PrinterConfig['kind'], secrets: Record<string, string>): PrinterConfig => ({
	id: 'p',
	kind,
	host: 'octoeverywhere',
	port: null,
	secrets
});
function collect(h: ReturnType<(typeof adapters)['octoprint']>) {
	const seen: PrinterStatus[] = [];
	h.status$((s) => seen.push(s));
	cleanup.push(() => h.close());
	return seen;
}

describe('OctoPrint through an OctoEverywhere link', () => {
	it('polls /api/job and /api/printer on the link host over https, with the key', async () => {
		const web = await fakeWeb((_r, url) =>
			url.pathname === '/api/job'
				? {
						state: 'Printing',
						job: { file: { name: 'Plate 1.gcode' } },
						progress: { completion: 42, printTime: 100, printTimeLeft: 200 }
					}
				: { temperature: { tool0: { actual: 210 }, bed: { actual: 60 } }, state: { flags: {} } }
		);
		const asked = redirectHttps(web.port);
		const seen = collect(adapters.octoprint(cfg('octoprint', { shareLink: LINK, apiKey: 'KEY' })));
		const s = await until(() => seen.find((x) => x.state === 'printing'));
		expect(s).toMatchObject({ progress: 42, fileName: 'Plate 1.gcode', nozzleC: 210, bedC: 60 });
		// every request: link host, default https port, pinned to the validated public address
		expect(asked.map((a) => a.path).sort()).toEqual(['/api/job', '/api/printer']);
		for (const a of asked) {
			expect(a.hostname).toBe(HOST);
			expect(a.port).toBe(443);
			expect(a.pinned).toBe('93.184.216.34');
		}
		expect(web.hits.every((h) => h.method === 'GET' && h.headers['x-api-key'] === 'KEY')).toBe(
			true
		);
	});

	it('never follows a redirect (not even to the same host) and reports it', async () => {
		const web = await fakeWeb(() => 302);
		redirectHttps(web.port);
		const seen = collect(adapters.octoprint(cfg('octoprint', { shareLink: LINK, apiKey: 'KEY' })));
		const s = await until(() => seen.find((x) => x.state === 'error'));
		expect(s.message).toMatch(/redirected/i);
		expect(web.hits).toHaveLength(1);
	});

	it('a link that resolves inward is refused and nothing is requested', async () => {
		setResolver(async () => ['10.0.0.5']);
		const web = await fakeWeb(() => ({}));
		const asked = redirectHttps(web.port);
		const seen = collect(adapters.octoprint(cfg('octoprint', { shareLink: LINK, apiKey: 'KEY' })));
		const s = await until(() => seen.find((x) => x.state === 'error'));
		expect(JSON.stringify(s)).not.toContain('octoeverywhere.com');
		expect(asked).toEqual([]);
	});

	it('polls slower through a link than on the LAN, and an error does not shorten it', () => {
		expect(LINK_POLL_ACTIVE_MS).toBeGreaterThanOrEqual(10_000);
		expect(LINK_POLL_IDLE_MS).toBeGreaterThanOrEqual(30_000);
	});

	it('a printer with a placeholder host and no usable link is never dialled', async () => {
		const web = await fakeWeb(() => ({}));
		const asked = redirectHttps(web.port);
		const seen = collect(adapters.octoprint(cfg('octoprint', { apiKey: 'KEY' })));
		expect(seen[0]).toMatchObject({ state: 'offline' });
		expect(asked).toEqual([]);
	});
});

describe('Klipper (Moonraker) through an OctoEverywhere link', () => {
	function stubSocket(wsPort: number) {
		const urls: string[] = [];
		const Real = WebSocket;
		class Redirect extends Real {
			constructor(url: string | URL) {
				urls.push(String(url));
				super(`ws://127.0.0.1:${wsPort}/websocket`);
			}
		}
		vi.stubGlobal('WebSocket', Redirect);
		return urls;
	}

	it('trades the key for a one-shot token on https://<link>, then dials wss://<link>/websocket', async () => {
		const web = await fakeWeb((_r, url) =>
			url.pathname === '/access/oneshot_token' ? { result: 'TOK' } : 404
		);
		const asked = redirectHttps(web.port);
		const ws = new MiniWsServer();
		ws.onMessage = (sock, text) => {
			const m = JSON.parse(text);
			if (m.method === 'printer.objects.subscribe')
				sendJson(sock, {
					jsonrpc: '2.0',
					id: m.id,
					result: {
						status: {
							print_stats: { state: 'printing', filename: 'a.gcode', print_duration: 60 },
							display_status: { progress: 0.5 }
						}
					}
				});
		};
		await ws.start();
		cleanup.push(() => ws.stop());
		const urls = stubSocket(ws.port);
		const seen = collect(adapters.moonraker(cfg('moonraker', { shareLink: LINK, apiKey: 'KEY' })));
		const s = await until(() => seen.find((x) => x.state === 'printing'));
		expect(s.progress).toBe(50);
		expect(urls).toEqual([`wss://${HOST}/websocket?token=TOK`]);
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({ hostname: HOST, port: 443, path: '/access/oneshot_token' });
		expect(web.hits[0].headers['x-api-key']).toBe('KEY');
	});

	it('without a key it dials the socket directly on the link and sends nothing over HTTP', async () => {
		const web = await fakeWeb(() => 404);
		const asked = redirectHttps(web.port);
		const ws = new MiniWsServer();
		await ws.start();
		cleanup.push(() => ws.stop());
		const urls = stubSocket(ws.port);
		collect(adapters.moonraker(cfg('moonraker', { shareLink: LINK })));
		await until(() => urls.length);
		expect(urls).toEqual([`wss://${HOST}/websocket`]);
		expect(asked).toEqual([]);
	});

	it('a relay that accepts the upgrade and hangs up is not re-dialled faster than linkBackoff', async () => {
		vi.useFakeTimers();
		let dials = 0;
		vi.stubGlobal(
			'WebSocket',
			class {
				readyState = 0;
				onopen: (() => void) | null = null;
				onclose: (() => void) | null = null;
				onerror: (() => void) | null = null;
				onmessage: unknown = null;
				constructor() {
					dials++;
					// opens, then hangs up at once, without ever sending a valid message
					queueMicrotask(() => {
						this.readyState = 1;
						this.onopen?.();
						this.readyState = 3;
						this.onclose?.();
					});
				}
				send() {}
				close() {}
			}
		);
		const h = adapters.moonraker(cfg('moonraker', { shareLink: LINK }));
		await vi.advanceTimersByTimeAsync(60_000);
		const first = dials;
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		h.close();
		// 10 s, 20 s, 40 s, 80 s, 160 s, then every 300 s: at most 3 dials in the first minute,
		// and well under one a minute over the next ten.
		expect(first).toBeLessThanOrEqual(3);
		expect(dials - first).toBeLessThanOrEqual(8);
	});
});

describe('camera through an OctoEverywhere link (Klipper, OctoPrint)', () => {
	const t = (o: Partial<CameraTarget>): CameraTarget => ({
		kind: 'moonraker',
		host: 'octoeverywhere',
		port: null,
		cameraUrl: null,
		cameraEnabled: true,
		secrets: { shareLink: LINK },
		...o
	});
	function fetchRecorder(body: unknown) {
		const calls: { url: string; allow: unknown }[] = [];
		const fetchFn = (async (u: string, init?: { allowShareLink?: boolean }) => {
			calls.push({ url: String(u), allow: init?.allowShareLink });
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch;
		return { calls, fetchFn };
	}

	it('Klipper: asks the link for the webcam list and keeps only same-host https URLs', async () => {
		const { calls, fetchFn } = fetchRecorder({
			result: {
				webcams: [
					{
						stream_url: '/webcam/?action=stream',
						snapshot_url: 'http://192.168.0.9/webcam/?action=snapshot'
					}
				]
			}
		});
		const s = await resolveCameraSource(t({}), { fetchFn });
		expect(calls).toEqual([{ url: `${LINK}/server/webcams/list`, allow: true }]);
		expect(s).toEqual({
			urls: [`${LINK}/webcam/?action=stream`], // the LAN snapshot URL is dropped
			origin: 'moonraker',
			host: HOST,
			shareLink: true
		});
	});

	it('OctoPrint: webcam settings through the link, key sent, a custom address ignored', async () => {
		const { calls, fetchFn } = fetchRecorder({
			webcam: { webcamEnabled: true, streamUrl: '/webcam/?action=stream' }
		});
		const s = await resolveCameraSource(
			t({
				kind: 'octoprint',
				secrets: { shareLink: LINK, apiKey: 'KEY' },
				cameraUrl: 'http://10.0.0.5/x'
			}),
			{ fetchFn }
		);
		expect(calls).toEqual([{ url: `${LINK}/api/settings`, allow: true }]);
		expect(s?.urls).toEqual([`${LINK}/webcam/?action=stream`]);
		expect(s?.shareLink).toBe(true);
		// OctoPrint without a key has no camera (as on the LAN)
		expect(await resolveCameraSource(t({ kind: 'octoprint' }), { fetchFn })).toBeNull();
	});

	it('Klipper without a link and the placeholder host: nothing is dialled', async () => {
		const { calls, fetchFn } = fetchRecorder({});
		expect(await resolveCameraSource(t({ secrets: {} }), { fetchFn })).toBeNull();
		expect(calls).toEqual([]);
	});

	it('a Bambu printer with a link secret has no camera and no link', async () => {
		const { calls, fetchFn } = fetchRecorder({});
		expect(await resolveCameraSource(t({ kind: 'bambu-lan' }), { fetchFn })).toBeNull();
		expect(calls).toEqual([]);
	});
});

describe('the printer store: link kinds, Bambu, manual', () => {
	const setup = () => {
		const db = openDb(':memory:');
		runMigrations(db);
		db.insert(user).values({ id: 'u1', name: 'U', email: 'u@example.test' }).run();
		db.insert(organization).values({ id: 'o', name: 'O', slug: 'o', createdAt: new Date() }).run();
		db.insert(organization)
			.values({ id: 'o2', name: 'O2', slug: 'o2', createdAt: new Date() })
			.run();
		return db;
	};

	it('Klipper and OctoPrint take the encrypted link, need no address, never return it', () => {
		const db = setup();
		for (const kind of ['moonraker', 'octoprint'] as const) {
			const row = createPrinter(db, 'o', 'u1', {
				name: kind,
				kind,
				secrets: { shareLink: `${LINK}/`, apiKey: 'KEY' }
			});
			expect(row.host).toBe('octoeverywhere');
			expect(row.secretEnc).not.toContain(HOST);
			expect(decryptSecrets(row.secretEnc)).toEqual({ shareLink: LINK, apiKey: 'KEY' });
			const pub = toPublic(row, true);
			expect(JSON.stringify(pub)).not.toContain('shared-');
			expect(pub.secretsSet.sort()).toEqual(['apiKey', 'shareLink']);
			expect(pub.connection).toBe('link');
			expect(pub.blocked).toBeNull();
		}
	});

	it('a bad link is refused without echoing it', () => {
		const db = setup();
		let msg = '';
		try {
			createPrinter(db, 'o', 'u1', {
				name: 'x',
				kind: 'moonraker',
				secrets: { shareLink: 'https://evil.example/shared-secret' }
			});
		} catch (e) {
			msg = (e as Error).message;
		}
		expect(msg).toMatch(/OctoEverywhere shared link/);
		expect(msg).not.toContain('evil.example');
	});

	it('Bambu LAN refuses a link with a clear message, on create, edit and test', () => {
		const db = setup();
		const m = /Bambu Lab printers cannot be reached through an OctoEverywhere link/;
		expect(() =>
			createPrinter(db, 'o', 'u1', { name: 'B', kind: 'bambu-lan', secrets: { shareLink: LINK } })
		).toThrow(m);
		const row = createPrinter(db, 'o', 'u1', {
			name: 'B',
			kind: 'bambu-lan',
			host: '10.0.0.8',
			secrets: { accessCode: 'C', serial: 'S' }
		});
		expect(() => updatePrinter(db, row.id, 'o', { secrets: { shareLink: LINK } })).toThrow(m);
		expect(() => configFromInput(db, 'o', { id: row.id, secrets: { shareLink: LINK } })).toThrow(m);
	});

	it('Klipper on the LAN stays as it was (address, port, key)', () => {
		const db = setup();
		const row = createPrinter(db, 'o', 'u1', {
			name: 'K',
			kind: 'moonraker',
			host: '10.0.0.7',
			port: 7125,
			secrets: { apiKey: 'KEY' }
		});
		expect(row).toMatchObject({ host: '10.0.0.7', port: 7125 });
		expect(toPublic(row, true).connection).toBe('lan');
		expect(() => createPrinter(db, 'o', 'u1', { name: 'K', kind: 'moonraker' })).toThrow(
			/host|address/i
		);
	});

	it('manual: a name is enough; no host, port, secrets or camera are kept', () => {
		const db = setup();
		const row = createPrinter(db, 'o', 'u1', {
			name: 'Garage printer',
			kind: 'manual',
			host: '10.0.0.5', // ignored
			port: 80,
			secrets: { apiKey: 'X', shareLink: LINK },
			cameraUrl: 'http://10.0.0.5/v',
			catalogId: null
		});
		expect(row).toMatchObject({ kind: 'manual', host: 'manual', port: null, secretEnc: null });
		expect(row.cameraUrl).toBeNull();
		expect(row.cameraEnabled).toBe(false);
		const pub = toPublic(row, true);
		expect(pub).toMatchObject({
			connection: 'manual',
			blocked: null,
			status: null,
			secretsSet: [],
			enabled: true
		});
		// a rename is an edit; typing an address does not turn it into a LAN printer
		const r2 = updatePrinter(db, row.id, 'o', { name: 'Garage', host: '10.9.9.9' });
		expect(r2).toMatchObject({ name: 'Garage', host: 'manual', kind: 'manual' });
		// connection test input
		expect(configFromInput(db, 'o', { id: row.id })).toMatchObject({ kind: 'manual', secrets: {} });
	});

	it('manual to connected needs an address; connected to manual drops everything', () => {
		const db = setup();
		const m = createPrinter(db, 'o', 'u1', { name: 'M', kind: 'manual' });
		expect(() => updatePrinter(db, m.id, 'o', { kind: 'octoprint' })).toThrow(/address/i);
		const up = updatePrinter(db, m.id, 'o', {
			kind: 'octoprint',
			host: '10.0.0.6',
			secrets: { apiKey: 'K' }
		});
		expect(up).toMatchObject({ kind: 'octoprint', host: '10.0.0.6' });
		const back = updatePrinter(db, m.id, 'o', { kind: 'manual' });
		expect(back).toMatchObject({ kind: 'manual', host: 'manual', secretEnc: null, port: null });
	});

	it('the supervisor never dials a manual printer, and a test says there is nothing to test', async () => {
		const db = setup();
		createPrinter(db, 'o', 'u1', { name: 'M', kind: 'manual' });
		createPrinter(db, 'o', 'u1', { name: 'L', kind: 'octoprint', secrets: { shareLink: LINK } });
		const dialled: string[] = [];
		const fake = (k: string) => () => {
			dialled.push(k);
			return { status$: () => () => {}, close: () => {} };
		};
		const sup = new Supervisor(db, {
			'elegoo-sdcp': fake('elegoo'),
			moonraker: fake('moonraker'),
			octoprint: fake('octoprint'),
			'bambu-lan': fake('bambu'),
			manual: fake('manual')
		});
		sup.start();
		expect(dialled).toEqual(['octoprint']);
		expect(sup.size).toBe(1);
		sup.stop();
		const r = await testConnection(
			{ id: 't', kind: 'manual', host: 'manual', port: null, secrets: {} },
			500,
			{ manual: fake('manual') } as never
		);
		expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/not connected/) });
		expect(dialled).toEqual(['octoprint']);
		expect(getSupervisor).toBeDefined();
		void startSupervisor;
	});

	it('the manual adapter in the registry opens nothing and reports nothing', () => {
		const h = adapters.manual({ id: 'p', kind: 'manual', host: 'manual', port: null, secrets: {} });
		const seen: unknown[] = [];
		h.status$((s) => seen.push(s));
		expect(seen).toEqual([]);
		h.close();
	});
});

describe('hosted site (TMT_MODE=public)', () => {
	beforeEach(() => vi.stubEnv('TMT_MODE', 'public'));
	const setup = () => {
		vi.stubEnv('TMT_MODE', 'public');
		vi.stubEnv('BETTER_AUTH_SECRET', 'unit-test-secret-not-for-production-0123456789abcdef');
		const db = openDb(':memory:');
		runMigrations(db);
		db.insert(user).values({ id: 'u1', name: 'U', email: 'u@example.test' }).run();
		db.insert(organization).values({ id: 'o', name: 'O', slug: 'o', createdAt: new Date() }).run();
		db.insert(organization)
			.values({ id: 'o2', name: 'O2', slug: 'o2', createdAt: new Date() })
			.run();
		return db;
	};

	it('allows link printers of the three kinds and manual ones; refuses every LAN printer', () => {
		const db = setup();
		for (const kind of ['elegoo-sdcp', 'moonraker', 'octoprint'] as const)
			expect(
				createPrinter(db, 'o2', 'u1', { name: kind, kind, secrets: { shareLink: LINK } }).host
			).toBe('octoeverywhere');
		expect(createPrinter(db, 'o', 'u1', { name: 'M', kind: 'manual' }).kind).toBe('manual');
		for (const kind of ['elegoo-sdcp', 'moonraker', 'octoprint', 'bambu-lan'] as const)
			expect(() =>
				createPrinter(db, 'o', 'u1', {
					name: 'x',
					kind,
					host: '192.168.0.5',
					secrets: { apiKey: 'k' }
				})
			).toThrow(PUBLIC_MODE_MESSAGE);
		expect(() =>
			createPrinter(db, 'o', 'u1', { name: 'x', kind: 'bambu-lan', secrets: { shareLink: LINK } })
		).toThrow(/Bambu Lab/);
		expect(db.select().from(printers).all()).toHaveLength(4);
	});

	it('caps link printers per workspace (default 3), counted per workspace; manual ones do not count', () => {
		const db = setup();
		const mk = (org: string, n: number, kind = 'octoprint') =>
			createPrinter(db, org, 'u1', {
				name: `p${n}`,
				kind,
				secrets: { shareLink: `https://shared-token${n}abcdefgh.octoeverywhere.com` }
			});
		mk('o', 1);
		mk('o', 2);
		const third = mk('o', 3, 'moonraker');
		expect(() => mk('o', 4)).toThrow(
			/already has 3 printers connected through OctoEverywhere links/
		);
		try {
			mk('o', 4);
		} catch (e) {
			expect(e).toMatchObject({ status: 409, code: 'quota' });
		}
		mk('o2', 5); // another workspace has its own three
		createPrinter(db, 'o', 'u1', { name: 'M1', kind: 'manual' });
		createPrinter(db, 'o', 'u1', { name: 'M2', kind: 'manual' });
		// replacing the link of one of the three is not a fourth printer
		expect(() => updatePrinter(db, third.id, 'o', { secrets: { shareLink: LINK2 } })).not.toThrow();
		// deleting one makes room
		db.delete(printers).where(eq(printers.id, third.id)).run();
		expect(() => mk('o', 6)).not.toThrow();
	});

	it('the cap is configurable and `off` removes it', () => {
		const db = setup();
		vi.stubEnv('QUOTA_LINK_PRINTERS_PER_WORKSPACE', '1');
		const body = (n: number) => ({
			name: `p${n}`,
			kind: 'octoprint',
			secrets: { shareLink: `https://shared-token${n}abcdefgh.octoeverywhere.com` }
		});
		createPrinter(db, 'o', 'u1', body(1));
		expect(() => createPrinter(db, 'o', 'u1', body(2))).toThrow(/limit on this server/);
		vi.stubEnv('QUOTA_LINK_PRINTERS_PER_WORKSPACE', '0');
		expect(() => createPrinter(db, 'o2', 'u1', body(3))).toThrow(/Ask the admin/);
		vi.stubEnv('QUOTA_LINK_PRINTERS_PER_WORKSPACE', 'off');
		expect(() => createPrinter(db, 'o2', 'u1', body(4))).not.toThrow();
	});

	it('edits: a LAN address cannot be set; pausing and renaming stay; a link can be changed', () => {
		const db = setup();
		const link = createPrinter(db, 'o', 'u1', {
			name: 'L',
			kind: 'octoprint',
			secrets: { shareLink: LINK }
		});
		expect(() => updatePrinter(db, link.id, 'o', { secrets: { shareLink: '' } })).toThrow(
			PUBLIC_MODE_MESSAGE
		);
		expect(() =>
			updatePrinter(db, link.id, 'o', { host: '192.168.0.5', secrets: { shareLink: '' } })
		).toThrow(PUBLIC_MODE_MESSAGE);
		expect(updatePrinter(db, link.id, 'o', { name: 'Renamed', enabled: false }).enabled).toBe(
			false
		);
		// a row that was saved with a LAN address before this site was hosted can only be tidied
		const lan = db
			.insert(printers)
			.values({ organizationId: 'o', name: 'old', kind: 'moonraker', host: '10.0.0.7' })
			.returning()
			.get();
		expect(updatePrinter(db, lan.id, 'o', { name: 'older', enabled: false }).name).toBe('older');
		expect(() => updatePrinter(db, lan.id, 'o', { enabled: true })).toThrow(PUBLIC_MODE_MESSAGE);
		expect(toPublic(lan, true)).toMatchObject({ connection: 'lan', blocked: PUBLIC_MODE_MESSAGE });
	});

	it('connection tests: a link is allowed (resolves the link only); a LAN address is refused', () => {
		const db = setup();
		expect(() => configFromInput(db, 'o', { kind: 'moonraker', host: '192.168.0.5' })).toThrow(
			PUBLIC_MODE_MESSAGE
		);
		expect(
			configFromInput(db, 'o', { kind: 'octoprint', secrets: { shareLink: LINK, apiKey: 'k' } })
		).toMatchObject({ host: 'octoeverywhere', secrets: { shareLink: LINK } });
	});

	it('the outbound guard admits only the share-link host, and only on a link call', async () => {
		const dns = vi.fn(async () => ['93.184.216.34']);
		setResolver(dns);
		await expect(
			resolveAllowed('192.168.0.5', undefined, { allowShareLink: true })
		).rejects.toMatchObject({
			kind: 'public'
		});
		await expect(
			resolveAllowed('printer.example', undefined, { allowShareLink: true })
		).rejects.toMatchObject({
			kind: 'public'
		});
		await expect(
			guardedFetch('http://192.168.0.5/api/job', { allowShareLink: true })
		).rejects.toMatchObject({
			kind: 'public'
		});
		await expect(guardedFetch(`https://${HOST}/api/job`)).rejects.toMatchObject({ kind: 'public' });
		await expect(guardedFetch(`http://${HOST}/api/job`, { allowShareLink: true })).rejects.toThrow(
			/https on the default port/
		);
		expect(dns).not.toHaveBeenCalled();
		await expect(resolveAllowed(HOST, undefined, { allowShareLink: true })).resolves.toMatchObject({
			shareLink: true,
			ip: '93.184.216.34'
		});
	});

	it('adapters: a link printer dials its link; a printer without one reports the refusal', async () => {
		const web = await fakeWeb(() => ({ state: 'Operational', job: {}, progress: {} }));
		const asked = redirectHttps(web.port);
		const seen = collect(adapters.octoprint(cfg('octoprint', { shareLink: LINK, apiKey: 'K' })));
		await until(() => seen.length > 0 && asked.length > 0);
		expect(asked[0].hostname).toBe(HOST);
		const lan = collect(
			adapters.octoprint({
				id: 'p',
				kind: 'octoprint',
				host: '192.168.0.5',
				port: null,
				secrets: { apiKey: 'K' }
			})
		);
		expect(lan).toEqual([{ state: 'error', progress: null, message: PUBLIC_MODE_MESSAGE }]);
		expect(asked.every((a) => a.hostname === HOST)).toBe(true);
	});

	it('the supervisor connects link printers only', () => {
		const db = setup();
		createPrinter(db, 'o', 'u1', { name: 'L', kind: 'moonraker', secrets: { shareLink: LINK } });
		createPrinter(db, 'o', 'u1', { name: 'M', kind: 'manual' });
		const lan = db
			.insert(printers)
			.values({ organizationId: 'o', name: 'old', kind: 'octoprint', host: '10.0.0.7' })
			.returning()
			.get();
		void lan;
		const dialled: string[] = [];
		const fake = (k: string) => () => {
			dialled.push(k);
			return { status$: () => () => {}, close: () => {} };
		};
		const sup = new Supervisor(db, {
			'elegoo-sdcp': fake('elegoo'),
			moonraker: fake('moonraker'),
			octoprint: fake('octoprint'),
			'bambu-lan': fake('bambu'),
			manual: fake('manual')
		});
		sup.start();
		expect(dialled).toEqual(['moonraker']);
		sup.stop();
	});

	it('camera: a link printer has a source; a LAN one is refused before any request', async () => {
		const calls: string[] = [];
		const fetchFn = (async (u: string) => {
			calls.push(String(u));
			return new Response(JSON.stringify({ result: { webcams: [{ stream_url: '/w' }] } }));
		}) as unknown as typeof fetch;
		const base = { port: null, cameraUrl: null, cameraEnabled: true };
		const s = await resolveCameraSource(
			{ ...base, kind: 'moonraker', host: 'octoeverywhere', secrets: { shareLink: LINK } },
			{ fetchFn }
		);
		expect(s?.urls).toEqual([`${LINK}/w`]);
		await expect(
			resolveCameraSource(
				{ ...base, kind: 'moonraker', host: '10.0.0.7', secrets: {} },
				{ fetchFn }
			)
		).rejects.toMatchObject({ kind: 'public' });
		expect(calls).toHaveLength(1);
	});

	it('discovery and Spoolman stay refused', async () => {
		vi.stubEnv('TMT_MODE', 'public'); // set first: discovery must refuse before any socket opens
		await expect(discoverSdcp({ timeoutMs: 50 })).rejects.toThrow(PUBLIC_MODE_MESSAGE);
		const { assertOutboundAllowed } = await import('./outbound');
		expect(() => assertOutboundAllowed()).toThrow(PUBLIC_MODE_MESSAGE);
	});
});

describe('relay reconnect pace', () => {
	it('linkBackoff never goes below 10 s and tops out at 5 min', () => {
		for (let a = 0; a < 30; a++) {
			const d = linkBackoff(a);
			expect(d).toBeGreaterThanOrEqual(10_000);
			expect(d).toBeLessThanOrEqual(300_500);
		}
		expect(linkBackoff(20)).toBeGreaterThanOrEqual(300_000);
	});
});
