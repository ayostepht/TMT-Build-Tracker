import { afterEach, describe, expect, it } from 'vitest';
import type { PrinterStatus } from '#lib/printers/status.ts';
import { adapters } from './adapters';
import { normalizeBambu } from './adapters/bambu';
import { normalizeOctoprint } from './adapters/octoprint';
import { MiniWsServer, sendJson, sendText } from './mini-ws';
import { MAX_FILE_NAME } from './outbound';
import type { AdapterHandle, PrinterConfig } from './types';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
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
const collect = (h: AdapterHandle) => {
	const seen: PrinterStatus[] = [];
	h.status$((s) => seen.push(s));
	cleanup.push(() => h.close());
	return seen;
};
const cfg = (kind: PrinterConfig['kind'], port: number): PrinterConfig => ({
	id: 'p',
	kind,
	host: '127.0.0.1',
	port,
	secrets: {}
});

describe('a hostile WebSocket peer cannot crash or poison the Moonraker adapter', () => {
	it('survives deep nesting and __proto__ keys, then keeps working', async () => {
		const uncaught: unknown[] = [];
		const onUncaught = (e: unknown) => uncaught.push(e);
		process.on('uncaughtException', onUncaught);
		cleanup.push(() => process.off('uncaughtException', onUncaught));

		const ws = new MiniWsServer();
		await ws.start();
		cleanup.push(() => ws.stop());
		const seen = collect(adapters.moonraker(cfg('moonraker', ws.port)));
		await until(() => ws.sockets.size > 0);
		const sock = [...ws.sockets][0];

		const depth = 100_000; // deeper than the JS stack allows for a recursive merge
		sendText(
			sock,
			'{"id":1,"result":{"status":' + '{"a":'.repeat(depth) + '1' + '}'.repeat(depth) + '}}'
		);
		// (An oversized frame now drops the connection; see adapters.oversize.test.ts.)
		sendText(
			sock,
			'{"jsonrpc":"2.0","method":"notify_status_update","params":[{"__proto__":{"polluted":"yes"}}]}'
		);
		sendJson(sock, {
			jsonrpc: '2.0',
			method: 'notify_status_update',
			params: [
				{ print_stats: { state: 'printing', filename: 'f'.repeat(5000) + '\u0007.gcode' } },
				1
			]
		});
		const p = await until(() => seen.find((s) => s.state === 'printing'));
		expect(p.fileName!.length).toBeLessThanOrEqual(MAX_FILE_NAME);
		expect(p.fileName).not.toContain('\u0007');
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(uncaught).toEqual([]);
	}, 20000);
});

describe('printer-reported file names are bounded at the adapter edge', () => {
	const long = 'x'.repeat(900) + '\n.gcode';
	it('bambu and octoprint', () => {
		const b = normalizeBambu({ gcode_state: 'RUNNING', subtask_name: long });
		expect(b.fileName!.length).toBeLessThanOrEqual(MAX_FILE_NAME);
		const o = normalizeOctoprint(
			{ state: 'Printing', job: { file: { name: long } }, progress: { completion: 5 } },
			null
		);
		expect(o.fileName!.length).toBeLessThanOrEqual(MAX_FILE_NAME);
		expect(o.fileName).not.toContain('\n');
	});
	it('a normal slicer name passes through unchanged', () => {
		const name = 'TMT_4691_PETG_plate_3_of_7_0.2mm_14h40m.gcode.3mf';
		expect(normalizeBambu({ gcode_state: 'RUNNING', subtask_name: name }).fileName).toBe(name);
	});
});
