/**
 * The one WebSocket client for printers (Klipper and Elegoo, LAN and OctoEverywhere link), built on
 * `ws` instead of the runtime's global WebSocket: `ws` enforces `maxPayload` while a frame is being
 * received (the global one buffers up to ~128 MiB first), so a hostile peer can never make the
 * server hold more than `MAX_REMOTE_MESSAGE_BYTES` for one message.
 *
 *  - `maxPayload` = `MAX_REMOTE_MESSAGE_BYTES`, counted on the bytes of the whole (reassembled)
 *    message. Over the cap the socket is closed with 1009 and the adapter sees close code 1009.
 *  - `perMessageDeflate: false`: no compression is offered. A peer that sends a compressed frame
 *    anyway is closed for a protocol error (RSV1 set). (Even when enabled, `ws` applies
 *    `maxPayload` to the inflated data, so this is belt and braces.)
 *  - `handshakeTimeout`, `followRedirects: false`, no `unexpected-response` handler: a 3xx or any
 *    non-101 answer aborts the handshake and is never followed.
 *  - No optional native add-ons (`bufferutil`, `utf-8-validate`) are installed; `ws` falls back to
 *    plain JS silently.
 *  - Link sockets: `pin` dials the address `resolveAllowed` validated (via `lookup`), with SNI and
 *    certificate checks for the link host, so the name cannot resolve differently at dial time.
 *
 * Error text from `ws` / TLS is never surfaced: adapters ignore `onerror` and only show their own
 * fixed messages, so a link host or token cannot leak through here.
 *
 * Tests replace the socket with `setSocketFactory` (nothing here may open a socket in a test
 * unless it is a loopback server).
 */
import { WebSocket as Ws } from 'ws';
import { MAX_REMOTE_MESSAGE_BYTES } from './outbound';
import { CONNECT_TIMEOUT_MS } from './types';

export interface SocketMessage {
	/** Text of a text frame; anything else (binary) arrives as a non-string. */
	data: unknown;
	/** Size of the message in bytes on the wire (not UTF-16 characters). */
	bytes?: number;
}

/** The part of a socket the adapters use. Real sockets and test fakes both fit it. */
export interface SocketLike {
	readyState: number;
	send(data: string): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((ev: SocketMessage) => void) | null;
	onerror: (() => void) | null;
	onclose: ((ev: { code?: number }) => void) | null;
}

export interface SocketPin {
	ip: string;
	family: 4 | 6;
	/** TLS server name (the link host). */
	servername: string;
}

export interface SocketOpts {
	pin?: SocketPin;
	/** Tests only: a shorter handshake timeout than `CONNECT_TIMEOUT_MS`. */
	handshakeTimeoutMs?: number;
}

export type SocketFactory = (url: string, opts?: SocketOpts) => SocketLike;

class WsSocket implements SocketLike {
	onopen: (() => void) | null = null;
	onmessage: ((ev: SocketMessage) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: ((ev: { code?: number }) => void) | null = null;
	private oversize = false;
	private ws: Ws;

	constructor(url: string, pin?: SocketPin, handshakeTimeoutMs = CONNECT_TIMEOUT_MS) {
		this.ws = new Ws(url, {
			maxPayload: MAX_REMOTE_MESSAGE_BYTES,
			handshakeTimeout: handshakeTimeoutMs,
			perMessageDeflate: false,
			followRedirects: false,
			maxRedirects: 0,
			...(pin
				? {
						servername: pin.servername,
						rejectUnauthorized: true,
						lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => {
							if (o?.all) cb(null, [{ address: pin.ip, family: pin.family }]);
							else cb(null, pin.ip, pin.family);
						}) as never
					}
				: {})
		});
		this.ws.on('open', () => this.onopen?.());
		this.ws.on('message', (raw: Buffer, isBinary: boolean) => {
			const bytes = raw.length;
			this.onmessage?.({ data: isBinary ? raw : raw.toString('utf8'), bytes });
		});
		this.ws.on('error', (e: Error & { code?: string }) => {
			if (e?.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') this.oversize = true;
			this.onerror?.();
		});
		this.ws.on('close', (code: number) => this.onclose?.({ code: this.oversize ? 1009 : code }));
	}
	get readyState() {
		return this.ws.readyState;
	}
	send(data: string) {
		this.ws.send(data);
	}
	close() {
		// A socket still connecting is torn down at once; an open one gets a normal close.
		if (this.ws.readyState === Ws.CONNECTING) this.ws.terminate();
		else this.ws.close();
	}
}

const realFactory: SocketFactory = (url, opts) =>
	new WsSocket(url, opts?.pin, opts?.handshakeTimeoutMs);
let factory: SocketFactory = realFactory;

/** Tests only: swap the socket (null restores `ws`). */
export function setSocketFactory(f: SocketFactory | null) {
	factory = f ?? realFactory;
}

export const openSocket: SocketFactory = (url, opts) => factory(url, opts);
