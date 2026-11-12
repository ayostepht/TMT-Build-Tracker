/**
 * r49 security fixes: socket flood budget, handshake timeout, silent-socket close, instance-wide
 * and manual printer caps, the test-route rate limit and uniform hosted failures, and the camera
 * URL cap. Nothing here opens a real socket: the global WebSocket is replaced by an in-memory fake
 * BEFORE any adapter is created, DNS is a stub, and HTTP goes through an injected fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError } from '../access';
import { openDb, runMigrations } from '../db';
import { organization, printers, user } from '../db/schema';
import { adapters } from './adapters';
import { resolveCameraSource, MAX_CAMERA_URLS, type CameraTarget } from './camera-source';
import { OutboundError, resolveAllowed, setResolver } from './outbound';
import { createPrinter, updatePrinter } from './store';
import { HOSTED_LINK_FAILURE, limitTests, TEST_RATE, uniformHostedFailure } from './test-limit';
import {
	FLOODED_MESSAGE,
	MessageBudget,
	OVERSIZED_MESSAGE,
	SOCKET_MAX_MESSAGES_PER_SEC,
	type PrinterConfig
} from './types';
import { resetWriteRate } from '../write-rate';
import type { PrinterStatus } from '#lib/printers/status.ts';

const HOST = 'shared-testtoken12345678.octoeverywhere.com';
const LINK = `https://${HOST}`;

/** In-memory stand-in for the global WebSocket: never touches the network. */
class FakeWs {
	static all: FakeWs[] = [];
	readyState = 0;
	closed = false;
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((e: { data: unknown }) => void) | null = null;
	constructor(public url: string) {
		FakeWs.all.push(this);
	}
	send(d: string) {
		this.sent.push(d);
	}
	close() {
		this.closed = true;
		this.readyState = 3;
	}
	open() {
		this.readyState = 1;
		this.onopen?.();
	}
	deliver(data: unknown) {
		this.onmessage?.({ data });
	}
}

const cfg = (kind: PrinterConfig['kind'], secrets: Record<string, string> = { shareLink: LINK }) =>
	({ id: 'p', kind, host: 'octoeverywhere', port: null, secrets }) as PrinterConfig;
const flush = () => vi.advanceTimersByTimeAsync(0);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
	FakeWs.all = [];
	vi.useFakeTimers();
	vi.stubGlobal('WebSocket', FakeWs);
	setResolver(async () => ['93.184.216.34']);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	setResolver(null);
	resetWriteRate();
});

function watch(h: ReturnType<(typeof adapters)['moonraker']>) {
	const seen: PrinterStatus[] = [];
	h.status$((s) => seen.push(s));
	return seen;
}

describe('MessageBudget', () => {
	it('allows the budget per one-second window, then refuses, then resets', () => {
		let now = 1000;
		const b = new MessageBudget(() => now, 3, 100);
		expect([b.take(10), b.take(10), b.take(10), b.take(10)]).toEqual([true, true, true, false]);
		now += 1000;
		expect(b.take(60)).toBe(true);
		expect(b.take(60)).toBe(false); // bytes over 100 in the window
	});
});

describe('flooding peers (Klipper and Elegoo sockets)', () => {
	it('Klipper over a link: a message flood closes the socket and waits well over linkBackoff', async () => {
		const h = adapters.moonraker(cfg('moonraker'));
		const seen = watch(h);
		await flush();
		const ws = FakeWs.all[0];
		ws.open();
		const msg = JSON.stringify({ jsonrpc: '2.0', method: 'notify_proc_stat_update', params: [] });
		for (let i = 0; i < SOCKET_MAX_MESSAGES_PER_SEC; i++) ws.deliver(msg);
		expect(ws.closed).toBe(false); // exactly the budget is fine
		ws.deliver(msg);
		expect(ws.closed).toBe(true);
		expect(seen.at(-1)).toMatchObject({ state: 'error', message: FLOODED_MESSAGE });
		await tick(59_000);
		expect(FakeWs.all).toHaveLength(1); // hostile penalty: 60 s at least
		await tick(2000);
		expect(FakeWs.all).toHaveLength(2);
		h.close();
	});

	it('a big message burst trips the bytes budget; an over-cap message is never parsed', async () => {
		const h = adapters.moonraker(cfg('moonraker'));
		const seen = watch(h);
		await flush();
		const ws = FakeWs.all[0];
		ws.open();
		const parse = vi.spyOn(JSON, 'parse');
		const huge = 'x'.repeat(1024 * 1024 + 1);
		ws.deliver(huge);
		expect(ws.closed).toBe(true);
		expect(seen.at(-1)).toMatchObject({ state: 'error', message: OVERSIZED_MESSAGE });
		expect(parse.mock.calls.some((c) => c[0] === huge)).toBe(false);
		await tick(62_000);
		const ws2 = FakeWs.all[1];
		ws2.open();
		const chunk = JSON.stringify({ a: 'y'.repeat(900 * 1024) });
		ws2.deliver(chunk);
		ws2.deliver(chunk);
		expect(ws2.closed).toBe(false);
		ws2.deliver(chunk); // 2.7 MB in one second
		expect(ws2.closed).toBe(true);
		expect(seen.at(-1)).toMatchObject({ message: FLOODED_MESSAGE });
		h.close();
	});

	it('Elegoo over a link: the same budget applies', async () => {
		const h = adapters['elegoo-sdcp'](cfg('elegoo-sdcp'));
		const seen = watch(h);
		await flush();
		const ws = FakeWs.all[0];
		expect(ws.url).toBe(`wss://${HOST}/websocket`);
		ws.open();
		const msg = JSON.stringify({ Topic: 'sdcp/status/X', Status: {} });
		for (let i = 0; i <= SOCKET_MAX_MESSAGES_PER_SEC; i++) ws.deliver(msg);
		expect(ws.closed).toBe(true);
		expect(seen.at(-1)).toMatchObject({ message: FLOODED_MESSAGE });
		h.close();
	});
});

describe('handshake timeout and silent sockets', () => {
	it('Klipper over a link: a handshake that never completes is abandoned after 10 s and retried slowly', async () => {
		const h = adapters.moonraker(cfg('moonraker'));
		const seen = watch(h);
		await flush();
		const ws = FakeWs.all[0];
		await tick(9_000);
		expect(ws.closed).toBe(false);
		await tick(1_500);
		expect(ws.closed).toBe(true);
		expect(seen.at(-1)).toMatchObject({ state: 'offline', message: /Timed out connecting/ });
		await tick(8_000); // linkBackoff(0) is at least 10 s after the abandon
		expect(FakeWs.all).toHaveLength(1);
		await tick(3_000);
		expect(FakeWs.all).toHaveLength(2);
		h.close();
	});

	it('Elegoo (link and LAN): the same handshake timeout', async () => {
		for (const c of [
			cfg('elegoo-sdcp'),
			{ ...cfg('elegoo-sdcp', { mainboardId: 'ABCDEF' }), host: '10.0.0.5', port: 3030 }
		]) {
			FakeWs.all = [];
			const h = adapters['elegoo-sdcp'](c);
			await flush();
			expect(FakeWs.all).toHaveLength(1); // the stub was used: nothing real was dialled
			await tick(10_500);
			expect(FakeWs.all[0].closed).toBe(true);
			h.close();
		}
	});

	it('Klipper over a link: silence reports offline at 45 s but the socket is closed only at 120 s', async () => {
		const h = adapters.moonraker(cfg('moonraker'));
		const seen = watch(h);
		await flush();
		const ws = FakeWs.all[0];
		ws.open();
		await tick(46_000);
		expect(ws.closed).toBe(false);
		expect(seen.at(-1)).toMatchObject({ state: 'offline', message: 'No data from the printer' });
		await tick(70_000); // 116 s
		expect(ws.closed).toBe(false);
		await tick(5_000); // 121 s
		expect(ws.closed).toBe(true);
		await tick(9_000);
		expect(FakeWs.all).toHaveLength(1); // linkBackoff: not at once
		await tick(3_000);
		expect(FakeWs.all).toHaveLength(2);
		h.close();
	});

	it('Elegoo over a link: offline at 20 s, closed only at 120 s; data in between keeps it open', async () => {
		const h = adapters['elegoo-sdcp'](cfg('elegoo-sdcp'));
		const seen = watch(h);
		await flush();
		const ws = FakeWs.all[0];
		ws.open();
		await tick(21_000);
		expect(ws.closed).toBe(false);
		expect(seen.at(-1)).toMatchObject({ state: 'offline', message: 'No data from the printer' });
		ws.deliver(JSON.stringify({ Topic: 'sdcp/status/X', Status: {} })); // data re-arms it
		await tick(100_000);
		expect(ws.closed).toBe(false);
		await tick(25_000);
		expect(ws.closed).toBe(true);
		h.close();
	});

	it('LAN keeps the short limits: Klipper closes at 45 s, Elegoo at 20 s', async () => {
		const lanK = adapters.moonraker({
			id: 'p',
			kind: 'moonraker',
			host: '10.0.0.7',
			port: null,
			secrets: {}
		});
		await flush();
		expect(FakeWs.all).toHaveLength(1); // the stub: nothing real was dialled
		FakeWs.all[0].open();
		await tick(46_000);
		expect(FakeWs.all[0].closed).toBe(true);
		lanK.close();
		FakeWs.all = [];
		const lanE = adapters['elegoo-sdcp']({
			...cfg('elegoo-sdcp', { mainboardId: 'ABCDEF' }),
			host: '10.0.0.5',
			port: 3030
		});
		await flush();
		expect(FakeWs.all).toHaveLength(1);
		FakeWs.all[0].open();
		await tick(20_500);
		expect(FakeWs.all[0].closed).toBe(true);
		lanE.close();
	});
});

describe('hosted caps', () => {
	const setup = () => {
		vi.stubEnv('TMT_MODE', 'public');
		vi.stubEnv('BETTER_AUTH_SECRET', 'unit-test-secret-not-for-production-0123456789abcdef');
		const db = openDb(':memory:');
		runMigrations(db);
		db.insert(user).values({ id: 'u1', name: 'U', email: 'u@example.test' }).run();
		for (const id of ['o1', 'o2', 'o3'])
			db.insert(organization).values({ id, name: id, slug: id, createdAt: new Date() }).run();
		return db;
	};
	const link = (n: number) => ({
		name: `p${n}`,
		kind: 'octoprint',
		secrets: { shareLink: `https://shared-token${n}abcdefgh.octoeverywhere.com` }
	});

	it('an instance-wide cap on link printers (default 200), with a clear 409', () => {
		const db = setup();
		vi.stubEnv('QUOTA_LINK_PRINTERS_TOTAL', '3');
		vi.stubEnv('QUOTA_LINK_PRINTERS_PER_WORKSPACE', 'off');
		createPrinter(db, 'o1', 'u1', link(1));
		createPrinter(db, 'o2', 'u1', link(2));
		createPrinter(db, 'o3', 'u1', link(3));
		let err: unknown;
		try {
			createPrinter(db, 'o1', 'u1', link(4));
		} catch (e) {
			err = e;
		}
		expect(err).toMatchObject({
			status: 409,
			code: 'quota',
			message: expect.stringMatching(/This server has reached its limit of printers connected/)
		});
		expect(db.select().from(printers).all()).toHaveLength(3);
		// moving an existing link printer to another link is not a new one
		const first = db.select().from(printers).where(eq(printers.organizationId, 'o1')).get()!;
		expect(() =>
			updatePrinter(db, first.id, 'o1', {
				secrets: { shareLink: 'https://shared-tokenzzabcdefgh.octoeverywhere.com' }
			})
		).not.toThrow();
		// `off` removes it; self-hosted has none by default
		vi.stubEnv('QUOTA_LINK_PRINTERS_TOTAL', 'off');
		expect(() => createPrinter(db, 'o1', 'u1', link(5))).not.toThrow();
	});

	it('the instance-wide default is 200 in public mode', () => {
		const db = setup();
		vi.stubEnv('QUOTA_LINK_PRINTERS_PER_WORKSPACE', 'off');
		const rows = Array.from({ length: 200 }, (_, i) => ({
			organizationId: 'o1',
			name: `x${i}`,
			kind: 'octoprint',
			host: 'octoeverywhere'
		}));
		for (const r of rows) db.insert(printers).values(r).run();
		expect(() => createPrinter(db, 'o2', 'u1', link(1))).toThrow(/limit of printers connected/);
	});

	it('manual printers: 10 per workspace by default in public mode, configurable, not on self-hosted', () => {
		const db = setup();
		for (let i = 0; i < 10; i++) createPrinter(db, 'o1', 'u1', { name: `m${i}`, kind: 'manual' });
		let err: unknown;
		try {
			createPrinter(db, 'o1', 'u1', { name: 'm10', kind: 'manual' });
		} catch (e) {
			err = e;
		}
		expect(err).toMatchObject({
			status: 409,
			code: 'quota',
			message: expect.stringMatching(/already has 10 printers that are not connected/)
		});
		createPrinter(db, 'o2', 'u1', { name: 'other workspace', kind: 'manual' });
		// turning a link printer into a manual one counts too
		const l = createPrinter(db, 'o3', 'u1', link(1));
		vi.stubEnv('QUOTA_MANUAL_PRINTERS_PER_WORKSPACE', '0');
		expect(() => updatePrinter(db, l.id, 'o3', { kind: 'manual' })).toThrow(/Ask the admin/);
		vi.stubEnv('QUOTA_MANUAL_PRINTERS_PER_WORKSPACE', 'off');
		expect(updatePrinter(db, l.id, 'o3', { kind: 'manual' }).kind).toBe('manual');
		vi.unstubAllEnvs();
		const sh = openDb(':memory:');
		runMigrations(sh);
		sh.insert(user).values({ id: 'u1', name: 'U', email: 'u@example.test' }).run();
		sh.insert(organization).values({ id: 'o1', name: 'o', slug: 'o', createdAt: new Date() }).run();
		vi.stubEnv('BETTER_AUTH_SECRET', 'unit-test-secret-not-for-production-0123456789abcdef');
		for (let i = 0; i < 12; i++) createPrinter(sh, 'o1', 'u1', { name: `m${i}`, kind: 'manual' });
	});
});

describe('test routes: rate limit and uniform hosted failures', () => {
	it('10 a minute with a burst of 5 per user, separately per user', () => {
		const now = 1_000_000;
		for (let i = 0; i < TEST_RATE.burst; i++) limitTests('u1', now);
		expect(() => limitTests('u1', now)).toThrow(ApiError);
		try {
			limitTests('u1', now);
		} catch (e) {
			expect(e).toMatchObject({ status: 429, message: expect.stringMatching(/Too many tests/) });
		}
		expect(() => limitTests('u2', now)).not.toThrow();
		expect(() => limitTests('u1', now + 7_000)).not.toThrow(); // refills 1 per 6 s
	});

	it('on a hosted site "link not found", "points inward" and "refused" are the same sentence', async () => {
		vi.stubEnv('TMT_MODE', 'public');
		const fail = async (answers: () => Promise<string[]>) => {
			setResolver(answers);
			try {
				await uniformHostedFailure(() => resolveAllowed(HOST, undefined, { allowShareLink: true }));
			} catch (e) {
				return (e as Error).message;
			}
			return 'no error';
		};
		const msgs = await Promise.all([
			fail(async () => {
				throw new Error('ENOTFOUND');
			}),
			fail(async () => []),
			fail(async () => ['10.0.0.5'])
		]);
		expect(new Set(msgs)).toEqual(new Set([HOSTED_LINK_FAILURE]));
		// a LAN address on the hosted site gives the same sentence too
		await expect(
			uniformHostedFailure(() => resolveAllowed('192.168.0.5', undefined, { allowShareLink: true }))
		).rejects.toThrow(HOSTED_LINK_FAILURE);
		// self-hosted keeps the specific messages
		vi.unstubAllEnvs();
		await expect(
			uniformHostedFailure(() => resolveAllowed('8.8.8.8', undefined, { allowShareLink: true }))
		).rejects.toBeInstanceOf(OutboundError);
	});
});

describe('camera URLs from a remote printer', () => {
	const t = (): CameraTarget => ({
		kind: 'moonraker',
		host: 'octoeverywhere',
		port: null,
		cameraUrl: null,
		cameraEnabled: true,
		secrets: { shareLink: LINK }
	});
	const answer = (webcams: unknown[]) =>
		(async () => new Response(JSON.stringify({ result: { webcams } }))) as unknown as typeof fetch;

	it('looks at no more than 4 webcam entries', async () => {
		const bad = { stream_url: 'http://192.168.0.9/s', snapshot_url: 'http://192.168.0.9/p' };
		const cams = [bad, bad, bad, bad, { stream_url: '/webcam/?action=stream' }];
		expect(await resolveCameraSource(t(), { fetchFn: answer(cams) })).toBeNull();
		const ok = await resolveCameraSource(t(), {
			fetchFn: answer([bad, bad, bad, { stream_url: '/webcam/?action=stream' }])
		});
		expect(ok?.urls).toEqual([`${LINK}/webcam/?action=stream`]);
		expect(MAX_CAMERA_URLS).toBe(4);
	});

	it('drops a URL longer than 500 characters', async () => {
		const long = `/webcam/${'a'.repeat(600)}`;
		expect(await resolveCameraSource(t(), { fetchFn: answer([{ stream_url: long }]) })).toBeNull();
	});
});
