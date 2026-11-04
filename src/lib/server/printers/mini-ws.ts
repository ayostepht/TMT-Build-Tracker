/** Dependency-free WebSocket server (RFC 6455 text frames) for printer mocks in tests and e2e. */
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';

export class MiniWsServer {
	server: Server;
	port = 0;
	sockets = new Set<Socket>();
	/** Called for every text message a client sends. */
	onMessage: (socket: Socket, text: string) => void = () => {};
	/** Called when a client connects. */
	onConnect: (socket: Socket) => void = () => {};

	constructor() {
		this.server = createServer((_req, res) => res.writeHead(404).end());
		this.server.on('upgrade', (req, socket: Socket) => {
			const key = req.headers['sec-websocket-key'];
			if (typeof key !== 'string') return socket.destroy();
			const accept = createHash('sha1')
				.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
				.digest('base64');
			socket.write(
				`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
			);
			this.sockets.add(socket);
			socket.on('close', () => this.sockets.delete(socket));
			socket.on('error', () => {});
			let buf = Buffer.alloc(0);
			socket.on('data', (d) => {
				buf = Buffer.concat([buf, d]);
				for (;;) {
					const f = parseFrame(buf);
					if (!f) break;
					buf = buf.subarray(f.len);
					if (f.opcode === 8) return socket.end();
					if (f.opcode === 1) this.onMessage(socket, f.payload.toString('utf8'));
				}
			});
			this.onConnect(socket);
		});
	}

	start(port = 0, host = '127.0.0.1'): Promise<number> {
		return new Promise((resolve) =>
			this.server.listen(port, host, () => {
				this.port = (this.server.address() as { port: number }).port;
				resolve(this.port);
			})
		);
	}

	stop(): Promise<void> {
		for (const s of this.sockets) s.destroy();
		return new Promise((resolve) => this.server.close(() => resolve()));
	}

	/** Drop all connections (adapters should reconnect). */
	dropClients() {
		for (const s of this.sockets) s.destroy();
	}

	broadcast(obj: unknown) {
		for (const s of this.sockets) sendJson(s, obj);
	}
}

function parseFrame(b: Buffer): { opcode: number; payload: Buffer; len: number } | null {
	if (b.length < 2) return null;
	const opcode = b[0] & 0x0f;
	const masked = (b[1] & 0x80) !== 0;
	let len = b[1] & 0x7f;
	let off = 2;
	if (len === 126) {
		if (b.length < 4) return null;
		len = b.readUInt16BE(2);
		off = 4;
	} else if (len === 127) {
		if (b.length < 10) return null;
		len = Number(b.readBigUInt64BE(2));
		off = 10;
	}
	const maskKey = masked ? b.subarray(off, off + 4) : null;
	if (masked) off += 4;
	if (b.length < off + len) return null;
	const payload = Buffer.from(b.subarray(off, off + len));
	if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
	return { opcode, payload, len: off + len };
}

export function sendJson(socket: Socket, obj: unknown) {
	if (socket.destroyed) return;
	const data = Buffer.from(JSON.stringify(obj));
	let head: Buffer;
	if (data.length < 126) head = Buffer.from([0x81, data.length]);
	else if (data.length < 65536) {
		head = Buffer.alloc(4);
		head[0] = 0x81;
		head[1] = 126;
		head.writeUInt16BE(data.length, 2);
	} else {
		head = Buffer.alloc(10);
		head[0] = 0x81;
		head[1] = 127;
		head.writeBigUInt64BE(BigInt(data.length), 2);
	}
	socket.write(Buffer.concat([head, data]));
}
