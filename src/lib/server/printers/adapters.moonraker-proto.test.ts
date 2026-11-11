import { afterEach, describe, expect, it } from 'vitest';
import type { PrinterStatus } from '#lib/printers/status.ts';
import { adapters } from './adapters';
import { mergeStatus } from './adapters/moonraker';
import { MiniWsServer, sendJson } from './mini-ws';
import type { AdapterHandle, PrinterConfig } from './types';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	while (cleanup.length) await cleanup.pop()!();
	// in case a test fails after polluting
	delete (Object.prototype as Record<string, unknown>).polluted;
	delete (Object.prototype as Record<string, unknown>).polluted2;
});

// Built with JSON.parse so `__proto__` is an OWN key (an object literal would set the prototype).
const hostile = () =>
	JSON.parse(
		'{"__proto__":{"polluted":"yes"},"print_stats":{"state":"printing","filename":"a.gcode","__proto__":{"polluted2":1}},"display_status":{"progress":0.5}}'
	) as Record<string, unknown>;

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
const cfg = (port: number): PrinterConfig => ({
	id: 'p',
	kind: 'moonraker',
	host: '127.0.0.1',
	port,
	secrets: {}
});
function rawText(socket: import('node:net').Socket, text: string) {
	const data = Buffer.from(text);
	const head =
		data.length < 126
			? Buffer.from([0x81, data.length])
			: Buffer.concat([
					Buffer.from([0x81, 127]),
					(() => {
						const b = Buffer.alloc(8);
						b.writeBigUInt64BE(BigInt(data.length));
						return b;
					})()
				]);
	socket.write(Buffer.concat([head, data]));
}

describe('moonraker: hostile JSON from the device', () => {
	it('mergeStatus never touches Object.prototype, at any depth, and still merges normal fields', () => {
		const out = mergeStatus({}, hostile());
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
		expect((out.print_stats as Record<string, unknown>).state).toBe('printing');
		expect((out.display_status as Record<string, unknown>).progress).toBe(0.5);
		// a nested copy and an existing-object merge both skip it
		mergeStatus(
			out,
			JSON.parse(
				'{"print_stats":{"__proto__":{"polluted2":2}},"x":{"constructor":{"prototype":{"polluted":"no"}}}}'
			)
		);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
	});

	it('the subscribe reply and notify_status_update do not pollute the process, and normal fields merge', async () => {
		const ws = new MiniWsServer();
		ws.onMessage = (sock, text) => {
			const m = JSON.parse(text);
			if (m.method === 'printer.objects.subscribe')
				sendJson(sock, { jsonrpc: '2.0', id: m.id, result: { status: hostile() } });
		};
		await ws.start();
		cleanup.push(() => ws.stop());
		const seen = collect(adapters.moonraker(cfg(ws.port)));
		const first = await until(() => seen.find((s) => s.state === 'printing'));
		expect(first).toMatchObject({ progress: 50, fileName: 'a.gcode' });
		ws.broadcast({
			jsonrpc: '2.0',
			method: 'notify_status_update',
			params: [
				JSON.parse(
					'{"__proto__":{"polluted":"yes"},"print_stats":{"__proto__":{"polluted2":1},"state":"complete"}}'
				),
				1
			]
		});
		await until(() => seen.find((s) => s.state === 'done'));
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
	});

	it('a non-JSON frame and a 10,000-level nested frame do not throw, and the adapter keeps working', async () => {
		const ws = new MiniWsServer();
		ws.onMessage = (sock, text) => {
			const m = JSON.parse(text);
			if (m.method === 'printer.objects.subscribe') {
				rawText(sock, 'not json at all {');
				const deep = '{"a":'.repeat(10_000) + '1' + '}'.repeat(10_000);
				rawText(sock, `{"jsonrpc":"2.0","method":"notify_status_update","params":[${deep},1]}`);
				rawText(sock, `{"jsonrpc":"2.0","id":1,"result":{"status":${deep}}}`);
				sendJson(sock, {
					jsonrpc: '2.0',
					id: m.id,
					result: { status: { print_stats: { state: 'printing', filename: 'ok.gcode' } } }
				});
			}
		};
		await ws.start();
		cleanup.push(() => ws.stop());
		const errors: unknown[] = [];
		const onErr = (e: unknown) => errors.push(e);
		process.on('uncaughtException', onErr);
		cleanup.push(() => process.off('uncaughtException', onErr));
		const seen = collect(adapters.moonraker(cfg(ws.port)));
		await until(() => seen.find((s) => s.fileName === 'ok.gcode'));
		expect(errors).toEqual([]);
	});
});
