import { getEventListeners } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guardedFetch } from './outbound';

/** Every ordering of response / timeout / abort / error settles the promise once and frees the socket. */
describe('guardedFetch lifecycle (settle once, no leaks)', () => {
	let srv: Server;
	let port = 0;
	let handler: (req: IncomingMessage, res: ServerResponse) => void = () => {};
	let serverSockets: Socket[] = [];
	let uncaught: unknown[] = [];
	const onUncaught = (e: unknown) => uncaught.push(e);

	beforeEach(async () => {
		uncaught = [];
		serverSockets = [];
		process.on('uncaughtException', onUncaught);
		process.on('unhandledRejection', onUncaught);
		srv = createServer((req, res) => handler(req, res));
		srv.on('connection', (s) => serverSockets.push(s));
		await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
		port = (srv.address() as AddressInfo).port;
	});
	afterEach(async () => {
		// Give stray events a tick to surface before judging.
		await new Promise((r) => setTimeout(r, 30));
		process.off('uncaughtException', onUncaught);
		process.off('unhandledRejection', onUncaught);
		for (const s of serverSockets) s.destroy();
		await new Promise<void>((r) => srv.close(() => r()));
		expect(uncaught).toEqual([]);
	});
	const url = () => `http://127.0.0.1:${port}/x`;
	const allClosed = async () => {
		const t0 = Date.now();
		while (serverSockets.some((s) => !s.destroyed)) {
			if (Date.now() - t0 > 3000) throw new Error('a socket stayed open');
			await new Promise((r) => setTimeout(r, 20));
		}
	};
	const settle = <T>(p: Promise<T>) => {
		const log: string[] = [];
		const done = p.then(
			() => log.push('resolve'),
			() => log.push('reject')
		);
		return { log, done };
	};

	it('timeout before any response: rejects once and the socket is destroyed', async () => {
		handler = () => {}; // never answers
		const { log, done } = settle(guardedFetch(url(), { signal: AbortSignal.timeout(80) }));
		await done;
		await new Promise((r) => setTimeout(r, 100));
		expect(log).toEqual(['reject']);
		await allClosed();
	});

	it('response arriving after the timeout never resolves the promise', async () => {
		handler = (_req, res) => setTimeout(() => res.writeHead(200).end('late'), 250);
		const { log, done } = settle(guardedFetch(url(), { signal: AbortSignal.timeout(60) }));
		await done;
		await new Promise((r) => setTimeout(r, 350));
		expect(log).toEqual(['reject']);
		await allClosed();
	});

	it('already-aborted signal: rejects without leaving a connection', async () => {
		handler = (_req, res) => res.writeHead(200).end('x');
		const ctl = new AbortController();
		ctl.abort();
		const { log, done } = settle(guardedFetch(url(), { signal: ctl.signal }));
		await done;
		expect(log).toEqual(['reject']);
		await allClosed();
	});

	it('abort during the body: resolved once, the body read fails, the socket is destroyed', async () => {
		handler = (_req, res) => {
			res.writeHead(200, { 'content-type': 'text/plain' });
			res.write('part');
			// never ends
		};
		const ctl = new AbortController();
		const { log, done } = settle(guardedFetch(url(), { signal: ctl.signal }));
		await done;
		expect(log).toEqual(['resolve']);
		const res = await guardedFetch(url(), { signal: ctl.signal });
		const reader = res.body!.getReader();
		await reader.read();
		ctl.abort();
		await expect(reader.read()).rejects.toBeDefined();
		await allClosed();
	});

	it('connection dropped after the head: resolved once, body read fails, nothing is uncaught', async () => {
		handler = (_req, res) => {
			res.writeHead(200, { 'content-length': '100' });
			res.write('abc');
			setTimeout(() => res.socket?.destroy(), 30);
		};
		const { log, done } = settle(guardedFetch(url()));
		await done;
		expect(log).toEqual(['resolve']);
		const res = await guardedFetch(url());
		await expect(res.text()).rejects.toBeDefined();
		await allClosed();
	});

	it('a caller cancelling the body frees the socket', async () => {
		handler = (_req, res) => {
			res.writeHead(200);
			res.write('x'.repeat(1000));
		};
		const res = await guardedFetch(url());
		await res.body!.cancel();
		await allClosed();
		expect(serverSockets.every((x) => x.destroyed)).toBe(true);
	});

	it('a 3xx is returned without a body and its connection is dropped at once', async () => {
		handler = (_req, res) => {
			res.writeHead(302, { location: 'http://10.0.0.1/' });
			res.write('redirecting forever');
		};
		const res = await guardedFetch(url());
		expect(res.status).toBe(302);
		expect(res.body).toBeNull();
		await allClosed();
		expect(serverSockets.every((x) => x.destroyed)).toBe(true);
	});

	it('does not leave abort listeners behind on a long-lived signal', async () => {
		handler = (_req, res) => res.writeHead(204).end();
		const ctl = new AbortController();
		const before = getEventListeners(ctl.signal, 'abort').length;
		for (let i = 0; i < 5; i++) await guardedFetch(url(), { signal: ctl.signal });
		await new Promise((r) => setTimeout(r, 50));
		const after = getEventListeners(ctl.signal, 'abort').length;
		expect(after).toBe(before);
		await allClosed();
	});
});
