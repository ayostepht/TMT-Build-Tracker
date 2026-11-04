import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrinterStatus } from '#lib/printers/status.ts';
import { setMqttFactory, normalizeBambu } from './adapters/bambu';
import { adapters } from './adapters';
import { mergeStatus } from './adapters/moonraker';
import { extractFilaments, normalizeSdcpStatus } from './adapters/sdcp';
import { MiniWsServer, sendJson } from './mini-ws';
import { MockSdcp } from './mock-sdcp';
import type { AdapterHandle, PrinterConfig } from './types';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	while (cleanup.length) await cleanup.pop()!();
	setMqttFactory(null);
});

function collect(h: AdapterHandle) {
	const seen: PrinterStatus[] = [];
	h.status$((s) => seen.push(s));
	cleanup.push(() => h.close());
	return seen;
}
async function until<T>(fn: () => T | undefined | false, ms = 5000): Promise<T> {
	const t0 = Date.now();
	for (;;) {
		const v = fn();
		if (v) return v;
		if (Date.now() - t0 > ms) throw new Error('timeout');
		await new Promise((r) => setTimeout(r, 25));
	}
}
const cfg = (kind: PrinterConfig['kind'], port: number, secrets = {}): PrinterConfig => ({
	id: 'p',
	kind,
	host: '127.0.0.1',
	port,
	secrets
});

describe('elegoo-sdcp adapter', () => {
	it('follows a full print lifecycle and only sends read-only commands', async () => {
		const mock = new MockSdcp();
		await mock.start();
		cleanup.push(() => mock.stop());
		// A mainboard id avoids the UDP probe so the test is fast.
		const seen = collect(
			adapters['elegoo-sdcp'](cfg('elegoo-sdcp', mock.port, { mainboardId: 'ABCDEF' }))
		);

		const idle = await until(() => seen.find((s) => s.state === 'idle'));
		expect(idle.progress).toBeNull();

		mock.printing('Plate 3 - Wings (Accent).gcode', 12);
		const p = await until(() => seen.find((s) => s.state === 'printing' && s.progress === 12));
		expect(p.fileName).toBe('Plate 3 - Wings (Accent).gcode');
		expect(p.layer).toBe(48);
		expect(p.totalLayers).toBe(400);
		expect(p.elapsedSec).toBe(720);
		expect(p.remainingSec).toBe(5280);
		expect(p.nozzleC).toBe(25);
		expect(p.chamberC).toBe(28);

		mock.set({ printStatus: 6 });
		await until(() => seen.find((s) => s.state === 'paused'));
		mock.set({ printStatus: 9, machineStatus: [0], progress: 100 });
		const done = await until(() => seen.find((s) => s.state === 'done'));
		expect(done.progress).toBe(100);
		mock.set({ printStatus: 8 });
		const stopped = await until(() => seen.find((s) => s.state === 'failed'));
		expect(stopped.cancelled).toBe(true);

		// Never anything but status / attribute refreshes.
		expect(mock.received.length).toBeGreaterThan(0);
		expect(mock.received.every((r) => r.cmd === 0 || r.cmd === 1)).toBe(true);
	});

	it('reports offline when the printer drops and reconnects', async () => {
		const mock = new MockSdcp();
		await mock.start();
		cleanup.push(() => mock.stop());
		const seen = collect(
			adapters['elegoo-sdcp'](cfg('elegoo-sdcp', mock.port, { mainboardId: 'A' }))
		);
		await until(() => seen.find((s) => s.state === 'idle'));
		mock.dropClients();
		await until(() => seen.find((s) => s.state === 'offline'));
		const before = seen.length;
		const back = await until(() => seen.slice(before).find((s) => s.state === 'idle'), 8000);
		expect(back.state).toBe('idle');
	}, 15000);

	it('maps status codes', () => {
		const n = (status: number, cur = [1]) =>
			normalizeSdcpStatus({
				CurrentStatus: cur,
				PrintInfo: { Status: status, Filename: 'a.gcode', Progress: 5 }
			});
		expect(n(13).state).toBe('printing');
		expect(n(16).state).toBe('printing'); // preheating while a job runs
		expect(n(16, [0]).state).toBe('idle');
		expect(n(1, [9]).state).toBe('idle'); // manual homing
		expect(n(6).state).toBe('paused');
		expect(n(9).state).toBe('done');
		expect(n(14).state).toBe('error');
		expect(normalizeSdcpStatus({ TempOfNozzle: [200, 199.5], PrintInfo: {} }).nozzleC).toBe(199.5);
	});
	it('reads canvas-like tray lists when present and ignores them otherwise', () => {
		expect(extractFilaments({ Foo: 1 })).toEqual([]);
		const f = extractFilaments({
			CanvasInfo: {
				trays: [{ filament_color: '0xFF0000', filament_type: 'PLA' }, { color: '#00ff00' }]
			}
		});
		expect(f).toEqual([
			{ slot: 'A1', color: '#FF0000', type: 'PLA' },
			{ slot: 'A2', color: '#00ff00', type: undefined }
		]);
	});
});

describe('moonraker adapter', () => {
	it('subscribes and normalises print_stats updates', async () => {
		const ws = new MiniWsServer();
		const subs: unknown[] = [];
		ws.onMessage = (sock, text) => {
			const m = JSON.parse(text);
			subs.push(m.method);
			if (m.method === 'printer.objects.subscribe') {
				sendJson(sock, {
					jsonrpc: '2.0',
					id: m.id,
					result: {
						status: {
							print_stats: {
								state: 'printing',
								filename: 'wings.gcode',
								print_duration: 600,
								info: { current_layer: 10, total_layer: 100 }
							},
							display_status: { progress: 0.25 },
							extruder: { temperature: 215.2, target: 215 },
							heater_bed: { temperature: 60, target: 60 }
						}
					}
				});
			}
		};
		await ws.start();
		cleanup.push(() => ws.stop());
		const seen = collect(adapters.moonraker(cfg('moonraker', ws.port)));
		const p = await until(() => seen.find((s) => s.state === 'printing'));
		expect(p).toMatchObject({
			progress: 25,
			fileName: 'wings.gcode',
			layer: 10,
			totalLayers: 100,
			nozzleC: 215.2,
			bedC: 60,
			elapsedSec: 600,
			remainingSec: 1800
		});
		ws.broadcast({
			jsonrpc: '2.0',
			method: 'notify_status_update',
			params: [{ print_stats: { state: 'complete' } }, 1]
		});
		const d = await until(() => seen.find((s) => s.state === 'done'));
		expect(d.progress).toBe(100);
		expect(subs).toEqual(['printer.objects.subscribe']);
	});
	it('merges partial updates deeply', () => {
		expect(mergeStatus({ a: { b: 1, c: 2 } }, { a: { c: 3 }, d: 4 })).toEqual({
			a: { b: 1, c: 3 },
			d: 4
		});
	});
});

describe('octoprint adapter', () => {
	it('polls /api/job and /api/printer with the API key', async () => {
		const keys: (string | undefined)[] = [];
		let completion = 40;
		const srv: Server = createServer((req, res) => {
			keys.push(req.headers['x-api-key'] as string);
			res.setHeader('content-type', 'application/json');
			if (req.url === '/api/job')
				res.end(
					JSON.stringify({
						state: completion >= 100 ? 'Operational' : 'Printing',
						job: { file: { name: 'seat.gcode' } },
						progress: { completion, printTime: 100, printTimeLeft: 200 }
					})
				);
			else if (req.url === '/api/printer')
				res.end(
					JSON.stringify({
						temperature: { tool0: { actual: 210 }, bed: { actual: 55 } },
						state: { flags: { printing: completion < 100 } }
					})
				);
			else res.writeHead(404).end();
		});
		await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
		cleanup.push(() => new Promise((r) => srv.close(() => r(null))));
		const port = (srv.address() as { port: number }).port;
		const seen = collect(adapters.octoprint(cfg('octoprint', port, { apiKey: 'KEY123' })));
		const p = await until(() => seen.find((s) => s.state === 'printing'));
		expect(p).toMatchObject({
			progress: 40,
			fileName: 'seat.gcode',
			nozzleC: 210,
			bedC: 55,
			elapsedSec: 100,
			remainingSec: 200
		});
		expect(keys.every((k) => k === 'KEY123')).toBe(true);
		completion = 100;
		await until(() => seen.find((s) => s.state === 'done'), 6000);
	}, 12000);
	it('reports a rejected key', async () => {
		const srv = createServer((_q, res) => res.writeHead(403).end());
		await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
		cleanup.push(() => new Promise((r) => srv.close(() => r(null))));
		const seen = collect(
			adapters.octoprint(
				cfg('octoprint', (srv.address() as { port: number }).port, { apiKey: 'x' })
			)
		);
		const e = await until(() => seen.find((s) => s.state === 'error'));
		expect(e.message).toMatch(/API key/);
	});
});

describe('bambu-lan adapter', () => {
	it('subscribes to the report topic, sends only pushall, and merges deltas', async () => {
		class Fake extends EventEmitter {
			subscribed: string[] = [];
			published: { topic: string; payload: string }[] = [];
			subscribe(t: string, cb: (e?: Error) => void) {
				this.subscribed.push(t);
				cb();
			}
			publish(topic: string, payload: string) {
				this.published.push({ topic, payload });
			}
			end() {}
		}
		const fake = new Fake();
		let opts: Record<string, unknown> = {};
		setMqttFactory(((url: string, o: Record<string, unknown>) => {
			opts = { url, ...o };
			setTimeout(() => fake.emit('connect'), 5);
			return fake;
		}) as never);
		const seen = collect(
			adapters['bambu-lan'](cfg('bambu-lan', 8883, { accessCode: 'ACODE', serial: 'SER1' }))
		);
		await until(() => fake.published.length);
		expect(opts).toMatchObject({
			url: 'mqtts://127.0.0.1:8883',
			username: 'bblp',
			password: 'ACODE',
			rejectUnauthorized: false
		});
		expect(fake.subscribed).toEqual(['device/SER1/report']);
		expect(fake.published).toHaveLength(1);
		expect(fake.published[0].topic).toBe('device/SER1/request');
		expect(JSON.parse(fake.published[0].payload)).toEqual({
			pushing: { sequence_id: '0', command: 'pushall' }
		});

		fake.emit(
			'message',
			't',
			Buffer.from(
				JSON.stringify({
					print: {
						gcode_state: 'RUNNING',
						mc_percent: 30,
						layer_num: 5,
						total_layer_num: 50,
						mc_remaining_time: 20,
						subtask_name: 'Plate 1',
						nozzle_temper: 220,
						ams: {
							ams: [{ id: '0', tray: [{ id: '0', tray_color: 'FF0000FF', tray_type: 'PLA' }] }]
						}
					}
				})
			)
		);
		fake.emit('message', 't', Buffer.from(JSON.stringify({ print: { mc_percent: 31 } })));
		const s = await until(() => seen.find((x) => x.progress === 31));
		expect(s).toMatchObject({
			state: 'printing',
			fileName: 'Plate 1',
			remainingSec: 1200,
			layer: 5,
			nozzleC: 220
		});
		expect(s.filaments).toEqual([{ slot: 'A1', color: '#FF0000', type: 'PLA' }]);
		fake.emit('message', 't', Buffer.from(JSON.stringify({ print: { gcode_state: 'FINISH' } })));
		expect((await until(() => seen.find((x) => x.state === 'done'))).progress).toBe(100);
	});
	it('needs serial and access code', () => {
		const seen = collect(adapters['bambu-lan'](cfg('bambu-lan', 8883, {})));
		expect(seen[0].state).toBe('error');
		expect(normalizeBambu({ gcode_state: 'FAILED' }).state).toBe('failed');
	});
});
