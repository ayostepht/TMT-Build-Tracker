import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrinterStatus } from '#lib/printers/status.ts';
import { adapters } from './adapters';
import { MAX_BAMBU_PARTIAL_BYTES, setMqttFactory } from './adapters/bambu';
import { cameraOnEnvelope, enableSdcpCamera } from './adapters/sdcp';
import { MiniWsServer, sendJson, sendText } from './mini-ws';
import { MAX_REMOTE_MESSAGE_BYTES } from './outbound';
import {
	HOSTILE_BACKOFF_MAX_MS,
	HostileGuard,
	HOSTILE_RESET_MS,
	hostileBackoff,
	OVERSIZED_MESSAGE,
	type AdapterHandle,
	type PrinterConfig
} from './types';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	while (cleanup.length) await cleanup.pop()!();
	setMqttFactory(null);
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
const collect = (h: AdapterHandle) => {
	const seen: PrinterStatus[] = [];
	h.status$((s) => seen.push(s));
	cleanup.push(() => h.close());
	return seen;
};
const cfg = (kind: PrinterConfig['kind'], port: number, secrets = {}): PrinterConfig => ({
	id: 'p',
	kind,
	host: '127.0.0.1',
	port,
	secrets
});

describe('long backoff after an oversized message', () => {
	it('hostileBackoff starts at 60 s, doubles, caps at 15 min', () => {
		expect(hostileBackoff(1)).toBe(60_000);
		expect(hostileBackoff(2)).toBe(120_000);
		expect(hostileBackoff(3)).toBe(240_000);
		expect(hostileBackoff(5)).toBe(HOSTILE_BACKOFF_MAX_MS);
		expect(hostileBackoff(50)).toBe(HOSTILE_BACKOFF_MAX_MS);
	});
	it('strikes reset only after a period of normal messages', () => {
		let now = 1000;
		const g = new HostileGuard(() => now);
		expect(g.trip()).toBe(60_000);
		g.good();
		now += HOSTILE_RESET_MS - 1;
		g.good(); // not long enough
		expect(g.trip()).toBe(120_000);
		g.good();
		now += HOSTILE_RESET_MS + 1;
		g.good();
		expect(g.trip()).toBe(60_000);
	});
});

describe.each([
	['elegoo-sdcp', (m: MiniWsServer) => cfg('elegoo-sdcp', m.port, { mainboardId: 'MB1' })],
	['moonraker', (m: MiniWsServer) => cfg('moonraker', m.port)]
] as const)('%s: oversized or non-text frame', (kind, mk) => {
	const normal = (sock: Parameters<typeof sendJson>[0]) =>
		kind === 'moonraker'
			? sendJson(sock, {
					jsonrpc: '2.0',
					method: 'notify_status_update',
					params: [{ print_stats: { state: 'printing', filename: 'a.gcode' } }, 1]
				})
			: sendJson(sock, { Topic: 'sdcp/status/MB1', Status: { PrintInfo: { Status: 13 } } });

	it('closes the socket, reports a fixed error and does not reconnect quickly', async () => {
		const ws = new MiniWsServer();
		let connects = 0;
		ws.onConnect = () => connects++;
		await ws.start();
		cleanup.push(() => ws.stop());
		const seen = collect(adapters[kind](mk(ws)));
		await until(() => connects === 1);
		const sock = [...ws.sockets][0];
		const closed = new Promise<void>((r) => sock.on('close', () => r()));
		sendText(sock, '{"x":"' + 'A'.repeat(MAX_REMOTE_MESSAGE_BYTES + 10) + '"}');
		await closed;
		const err = await until(() => seen.find((s) => s.state === 'error'));
		expect(err.message).toBe(OVERSIZED_MESSAGE);
		// A normal reconnect would be back within ~2.5 s.
		await new Promise((r) => setTimeout(r, 3200));
		expect(connects).toBe(1);
		expect(seen.at(-1)?.state).toBe('error'); // not overwritten by "Disconnected"
	}, 15000);

	it('normal traffic is unaffected', async () => {
		const ws = new MiniWsServer();
		await ws.start();
		cleanup.push(() => ws.stop());
		const seen = collect(adapters[kind](mk(ws)));
		await until(() => ws.sockets.size > 0);
		normal([...ws.sockets][0]);
		await until(() => seen.find((s) => s.state === 'printing'));
		expect(seen.some((s) => s.message === OVERSIZED_MESSAGE)).toBe(false);
	});
});

describe('elegoo-sdcp: remote MainboardID is bounded', () => {
	it('a huge or control-laden id is cut before it is echoed back', async () => {
		const ws = new MiniWsServer();
		const requests: string[] = [];
		ws.onMessage = (_s, t) => requests.push(t);
		await ws.start();
		cleanup.push(() => ws.stop());
		collect(adapters['elegoo-sdcp'](cfg('elegoo-sdcp', ws.port)));
		await until(() => ws.sockets.size > 0);
		sendJson([...ws.sockets][0], { MainboardID: 'AB\u0007' + 'Z'.repeat(5000), Status: {} });
		// The next 4 s poll echoes the id the adapter kept.
		await until(() => requests.some((r) => r.includes('"Cmd":0') && r.includes('Z')), 9000);
		const echoed = requests.filter((x) => x.includes('Z'));
		expect(echoed.length).toBeGreaterThan(0);
		for (const r of echoed) {
			const j = JSON.parse(r);
			expect(j.Data.MainboardID.length).toBeLessThanOrEqual(64);
			expect(j.Data.MainboardID).not.toContain('\u0007');
		}
	}, 20000);
});

describe('camera-enable socket closes on an oversized frame', () => {
	it('finishes at once instead of waiting', async () => {
		const ws = new MiniWsServer();
		ws.onMessage = (sock, t) => {
			if (t.includes('"Cmd":386')) sendText(sock, 'A'.repeat(MAX_REMOTE_MESSAGE_BYTES + 10));
		};
		await ws.start();
		cleanup.push(() => ws.stop());
		expect(cameraOnEnvelope('MB1')).toContain('386');
		const t0 = Date.now();
		const sent = await enableSdcpCamera(cfg('elegoo-sdcp', ws.port, { mainboardId: 'MB1' }), {
			settleMs: 4000,
			timeoutMs: 8000
		});
		expect(sent).toBe(true);
		expect(Date.now() - t0).toBeLessThan(3000);
	});
});

describe('bambu-lan: oversized MQTT input', () => {
	class Fake extends EventEmitter {
		stream = new EventEmitter();
		ended = 0;
		subscribe(_t: string, cb: (e?: Error) => void) {
			cb();
		}
		publish() {}
		end() {
			this.ended++;
		}
	}
	const start = () => {
		const fake = new Fake();
		let connects = 0;
		setMqttFactory((() => {
			connects++;
			setTimeout(() => fake.emit('connect'), 5);
			return fake;
		}) as never);
		const seen = collect(
			adapters['bambu-lan'](cfg('bambu-lan', 8883, { accessCode: 'A', serial: 'S' }))
		);
		return { fake, seen, connects: () => connects };
	};

	it('force-ends the client past the byte cap between packets, then backs off long', async () => {
		const { fake, seen, connects } = start();
		await until(() => connects() === 1);
		const chunk = Buffer.alloc(1024 * 1024);
		for (let i = 0; i <= MAX_BAMBU_PARTIAL_BYTES / chunk.length; i++)
			fake.stream.emit('data', chunk);
		expect(fake.ended).toBe(1);
		expect(seen.at(-1)).toMatchObject({ state: 'error', message: OVERSIZED_MESSAGE });
		fake.emit('close'); // the real client closes after end(true): must not trigger a quick retry
		await new Promise((r) => setTimeout(r, 6500));
		expect(connects()).toBe(1);
	}, 15000);

	it('packets reset the counter, so normal traffic never trips it', async () => {
		const { fake, seen, connects } = start();
		await until(() => connects() === 1);
		const chunk = Buffer.alloc(1024 * 1024);
		for (let i = 0; i < 20; i++) {
			fake.stream.emit('data', chunk);
			fake.emit('packetreceive', {});
		}
		fake.emit('message', 't', Buffer.from(JSON.stringify({ print: { gcode_state: 'RUNNING' } })));
		await until(() => seen.find((s) => s.state === 'printing'));
		expect(fake.ended).toBe(0);
	});

	it('an oversized delivered message also ends the client with the long backoff', async () => {
		const { fake, seen, connects } = start();
		await until(() => connects() === 1);
		fake.emit('message', 't', Buffer.alloc(MAX_REMOTE_MESSAGE_BYTES + 1));
		expect(fake.ended).toBe(1);
		expect(seen.at(-1)?.message).toBe(OVERSIZED_MESSAGE);
	});
});
