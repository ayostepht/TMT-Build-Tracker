import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { guardedFetch, OutboundError } from './outbound';

let srv: Server | undefined;
afterEach(() => new Promise<void>((r) => (srv ? srv.close(() => r()) : r())));

/** A hostile LAN device that answers every request with a raw status line. */
async function serveStatus(line: string): Promise<number> {
	srv = createServer((sock) => {
		sock.on('error', () => {});
		sock.once('data', () =>
			sock.end(`${line}\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi`)
		);
	});
	await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
	return (srv.address() as AddressInfo).port;
}

describe('guardedFetch with an out-of-range HTTP status', () => {
	for (const code of [700, 999, 600]) {
		it(`rejects with an OutboundError for status ${code} instead of throwing out of band`, async () => {
			const port = await serveStatus(`HTTP/1.1 ${code} x`);
			const unhandled: unknown[] = [];
			const onUncaught = (e: unknown) => unhandled.push(e);
			process.on('uncaughtException', onUncaught);
			try {
				await expect(
					Promise.race([
						guardedFetch(`http://127.0.0.1:${port}/`),
						new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 1500))
					])
				).rejects.toBeInstanceOf(OutboundError);
				expect(unhandled).toEqual([]);
			} finally {
				process.off('uncaughtException', onUncaught);
			}
		});
	}
	it('rejects (never crashes) for interim 1xx statuses a device repeats', async () => {
		const port = await serveStatus('HTTP/1.1 199 x');
		await expect(guardedFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(Error);
	});
	it('still answers a normal status', async () => {
		const port = await serveStatus('HTTP/1.1 200 OK');
		const res = await guardedFetch(`http://127.0.0.1:${port}/`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('hi');
	});
});
