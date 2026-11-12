/**
 * The real `ws` client (ws-client.ts) against loopback-only servers: the message size cap is
 * enforced while a frame arrives, no compression, no redirects, handshake timeout, address pin.
 * Every socket here is 127.0.0.1.
 */
import { createServer, type Server } from 'node:http';
import { createServer as createTcp, type Server as TcpServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { adapters } from './adapters';
import { MiniWsServer } from './mini-ws';
import { MAX_REMOTE_MESSAGE_BYTES } from './outbound';
import { OVERSIZED_MESSAGE, type PrinterConfig } from './types';
import { openSocket, type SocketLike } from './ws-client';
import type { PrinterStatus } from '#lib/printers/status.ts';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	vi.useRealTimers();
	while (cleanup.length) await cleanup.pop()!();
});
async function until<T>(fn: () => T | undefined | false, ms = 5000): Promise<T> {
	const t0 = Date.now();
	for (;;) {
		const v = fn();
		if (v) return v;
		if (Date.now() - t0 > ms) throw new Error('timeout');
		await new Promise((r) => setTimeout(r, 20));
	}
}

async function wsServer(opts: ConstructorParameters<typeof WebSocketServer>[0] = {}) {
	const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, ...opts });
	await new Promise((r) => wss.on('listening', r));
	cleanup.push(() => new Promise((r) => wss.close(r)));
	const port = (wss.address() as { port: number }).port;
	return { wss, port };
}

/** A client plus a record of what it saw. */
function client(url: string, opts?: Parameters<typeof openSocket>[1]) {
	const got: { messages: { data: unknown; bytes?: number }[]; closes: (number | undefined)[] } = {
		messages: [],
		closes: []
	};
	const sock: SocketLike = openSocket(url, opts);
	sock.onmessage = (m) => got.messages.push(m);
	sock.onerror = () => {};
	sock.onclose = (e) => got.closes.push(e.code);
	cleanup.push(() => sock.close());
	return { sock, got };
}

describe('maxPayload is enforced by ws while the message arrives', () => {
	it('a 2 MiB message is never delivered and the socket closes with 1009', async () => {
		const { wss, port } = await wsServer();
		wss.on('connection', (s) => s.send('A'.repeat(2 * 1024 * 1024)));
		const { got } = client(`ws://127.0.0.1:${port}/`);
		await until(() => got.closes.length > 0);
		expect(got.closes).toEqual([1009]);
		expect(got.messages).toEqual([]);
	});

	it('the cap is in bytes: 600k two-byte characters (1.2 MB) are refused, a message at the cap is not', async () => {
		const { wss, port } = await wsServer();
		let n = 0;
		wss.on('connection', (s) => {
			if (n++ === 0) s.send('é'.repeat(600_000));
			else s.send('B'.repeat(MAX_REMOTE_MESSAGE_BYTES));
		});
		const a = client(`ws://127.0.0.1:${port}/`);
		await until(() => a.got.closes.length > 0);
		expect(a.got.closes).toEqual([1009]);
		expect(a.got.messages).toEqual([]);
		const b = client(`ws://127.0.0.1:${port}/`);
		await until(() => b.got.messages.length > 0);
		expect(b.got.messages[0].bytes).toBe(MAX_REMOTE_MESSAGE_BYTES);
	});

	it('a message split into small fragments is counted as a whole', async () => {
		const { wss, port } = await wsServer();
		wss.on('connection', (s) => {
			const part = 'C'.repeat(300 * 1024);
			for (let i = 0; i < 5; i++) s.send(part, { fin: i === 4 });
		});
		const { got } = client(`ws://127.0.0.1:${port}/`);
		await until(() => got.closes.length > 0);
		expect(got.closes).toEqual([1009]);
		expect(got.messages).toEqual([]);
	});

	it('a binary frame arrives as a non-string (the adapters then drop the socket)', async () => {
		const { wss, port } = await wsServer();
		wss.on('connection', (s) => s.send(Buffer.from([1, 2, 3])));
		const { got } = client(`ws://127.0.0.1:${port}/`);
		await until(() => got.messages.length > 0);
		expect(typeof got.messages[0].data).not.toBe('string');
	});
});

describe('no compression', () => {
	it('the handshake offers no extensions, even to a server that would take deflate', async () => {
		const { wss, port } = await wsServer({ perMessageDeflate: true });
		let offered: string | string[] | undefined = 'unset';
		wss.on('connection', (s, req) => {
			offered = req.headers['sec-websocket-extensions'];
			s.send('hi');
		});
		const { got } = client(`ws://127.0.0.1:${port}/`);
		await until(() => got.messages.length > 0);
		expect(offered).toBeUndefined();
	});

	it('a frame with the compression bit set is refused, never delivered', async () => {
		const m = new MiniWsServer();
		await m.start();
		cleanup.push(() => m.stop());
		const { got } = client(`ws://127.0.0.1:${m.port}/`);
		await until(() => m.sockets.size > 0);
		// FIN + RSV1 + text, 5 payload bytes: what a permessage-deflate frame looks like.
		[...m.sockets][0].write(Buffer.from([0xc1, 0x05, 1, 2, 3, 4, 5]));
		await until(() => got.closes.length > 0);
		expect(got.messages).toEqual([]);
		expect(got.closes[0]).not.toBe(1000);
	});
});

describe('handshake', () => {
	it('a peer that never answers the upgrade is abandoned at the handshake timeout', async () => {
		const silent: Socket[] = [];
		const tcp: TcpServer = createTcp((s) => {
			silent.push(s);
			s.on('error', () => {});
		});
		await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
		cleanup.push(() => {
			for (const s of silent) s.destroy();
			return new Promise((r) => tcp.close(r));
		});
		const port = (tcp.address() as { port: number }).port;
		const t0 = Date.now();
		// `ws` times the handshake with the socket's own timeout (not a global timer), so the
		// seam takes a short value; the production value is CONNECT_TIMEOUT_MS (10 s).
		const { got } = client(`ws://127.0.0.1:${port}/`, { handshakeTimeoutMs: 300 });
		await new Promise((r) => setTimeout(r, 150));
		expect(got.closes).toEqual([]);
		await until(() => got.closes.length > 0);
		expect(got.closes[0]).toBe(1006);
		expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
	});

	it('a redirect is never followed', async () => {
		let hits = 0;
		let other = 0;
		const target: Server = createServer((_q, r) => {
			other++;
			r.end();
		});
		await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
		cleanup.push(() => new Promise((r) => target.close(r)));
		const tport = (target.address() as { port: number }).port;
		const redirector: Server = createServer((_q, r) => {
			hits++;
			r.writeHead(302, { location: `http://127.0.0.1:${tport}/` }).end();
		});
		redirector.on('upgrade', (_q, s) => {
			hits++;
			s.end(`HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:${tport}/\r\n\r\n`);
		});
		await new Promise<void>((r) => redirector.listen(0, '127.0.0.1', r));
		cleanup.push(() => new Promise((r) => redirector.close(r)));
		const { got } = client(`ws://127.0.0.1:${(redirector.address() as { port: number }).port}/`);
		await until(() => got.closes.length > 0);
		await new Promise((r) => setTimeout(r, 100));
		expect(hits).toBe(1);
		expect(other).toBe(0);
		expect(got.messages).toEqual([]);
	});

	it('the pin decides the address, whatever the name resolves to', async () => {
		const { wss, port } = await wsServer();
		wss.on('connection', (s) => s.send('pinned'));
		// `pinned.invalid` cannot resolve anywhere: only the pin can make this connect.
		const { got } = client(`ws://pinned.invalid:${port}/`, {
			pin: { ip: '127.0.0.1', family: 4, servername: 'pinned.invalid' }
		});
		await until(() => got.messages.length > 0);
		expect(got.messages[0].data).toBe('pinned');
	});
});

describe('through the adapters (real ws, loopback)', () => {
	const cfg = (kind: PrinterConfig['kind'], port: number): PrinterConfig => ({
		id: 'p',
		kind,
		host: '127.0.0.1',
		port,
		secrets: kind === 'elegoo-sdcp' ? { mainboardId: 'MB1' } : {}
	});
	it.each(['moonraker', 'elegoo-sdcp'] as const)(
		'%s: a 2 MiB message gives the oversize state and no quick reconnect',
		async (kind) => {
			const { wss, port } = await wsServer();
			let connects = 0;
			wss.on('connection', (s) => {
				connects++;
				s.send('{"x":"' + 'A'.repeat(2 * 1024 * 1024) + '"}');
			});
			const seen: PrinterStatus[] = [];
			const h = adapters[kind](cfg(kind, port));
			h.status$((s) => seen.push(s));
			cleanup.push(() => h.close());
			const err = await until(() => seen.find((s) => s.state === 'error'));
			expect(err.message).toBe(OVERSIZED_MESSAGE);
			await new Promise((r) => setTimeout(r, 3200)); // a normal reconnect is back within ~2.5 s
			expect(connects).toBe(1);
			expect(seen.at(-1)?.state).toBe('error');
		},
		15000
	);

	it('an oversized frame sent with a lying small header size is cut off too (no buffering past the cap)', async () => {
		const m = new MiniWsServer();
		let connects = 0;
		m.onConnect = () => connects++;
		await m.start();
		cleanup.push(() => m.stop());
		const seen: PrinterStatus[] = [];
		const h = adapters.moonraker(cfg('moonraker', m.port));
		h.status$((s) => seen.push(s));
		cleanup.push(() => h.close());
		await until(() => m.sockets.size > 0);
		// Announce a 100 MiB frame but send only the header and a little data: ws refuses at the header.
		const head = Buffer.alloc(10);
		head[0] = 0x81;
		head[1] = 127;
		head.writeBigUInt64BE(BigInt(100 * 1024 * 1024), 2);
		[...m.sockets][0].write(Buffer.concat([head, Buffer.alloc(1024)]));
		const err = await until(() => seen.find((s) => s.state === 'error'));
		expect(err.message).toBe(OVERSIZED_MESSAGE);
		expect(connects).toBe(1);
	});
});
