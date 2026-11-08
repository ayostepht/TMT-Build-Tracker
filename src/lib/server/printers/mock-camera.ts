/**
 * A fake printer camera for tests and e2e (not used by the app): `/video` is an MJPEG
 * multipart stream (or a plain JPEG, or an error, by `mode`), `/snapshot` always one JPEG.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MockCameraMode = 'mjpeg' | 'jpeg' | 'error' | 'stall';

/** Not a decodable picture: enough for the parser (SOI ... EOI) with a recognisable payload. */
export function fakeJpeg(tag: string, size = 64): Buffer {
	const body = Buffer.alloc(size, 0x41);
	body.write(tag.slice(0, size), 0, 'latin1');
	return Buffer.concat([Buffer.from([0xff, 0xd8]), body, Buffer.from([0xff, 0xd9])]);
}

export class MockCamera {
	mode: MockCameraMode = 'mjpeg';
	/** Boundary as sent in the Content-Type; the body uses `--` + boundary unless it already starts with dashes. */
	boundary = 'frame';
	withLength = true;
	fps = 20;
	frames: Buffer[] = [fakeJpeg('frame-0')];
	/** When set, `/video` answers 500 "camera not ready" until this returns true (like the printer's camera before SDCP Cmd 386); a stream stops sending when it turns false. */
	readyWhen: (() => boolean) | null = null;
	active = 0;
	maxActive = 0;
	total = 0;
	/** Request paths, in order. */
	hits: string[] = [];
	private server: Server;
	private n = 0;

	constructor() {
		this.server = createServer((req, res) => this.handle(req, res));
	}

	get port(): number {
		return (this.server.address() as AddressInfo).port;
	}

	url(path = '/video', host = '127.0.0.1'): string {
		return `http://${host}:${this.port}${path}`;
	}

	start(): Promise<void> {
		return new Promise((r) => this.server.listen(0, '127.0.0.1', r));
	}

	stop(): Promise<void> {
		this.server.closeAllConnections();
		return new Promise((r) => this.server.close(() => r()));
	}

	private nextFrame(): Buffer {
		return this.frames[this.n++ % this.frames.length];
	}

	private handle(req: IncomingMessage, res: ServerResponse) {
		const path = (req.url ?? '/').split('?')[0];
		this.hits.push(path);
		this.total++;
		this.active++;
		this.maxActive = Math.max(this.maxActive, this.active);
		res.on('close', () => this.active--);
		if (path === '/video' && this.readyWhen && !this.readyWhen()) {
			res.writeHead(500, { 'content-type': 'text/plain' }).end('camera not ready');
			return;
		}
		if (path === '/snapshot' || (path === '/video' && this.mode === 'jpeg')) {
			const f = this.nextFrame();
			res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': f.length });
			res.end(f);
			return;
		}
		if (path !== '/video' || this.mode === 'error') {
			res.writeHead(path === '/video' ? 503 : 404).end();
			return;
		}
		const dashed = this.boundary.startsWith('-');
		const delim = dashed ? this.boundary : `--${this.boundary}`;
		res.writeHead(200, {
			'content-type': `multipart/x-mixed-replace; boundary=${this.boundary}`,
			'cache-control': 'no-cache'
		});
		if (this.mode === 'stall') return; // headers only, then silence
		const send = () => {
			if (this.readyWhen && !this.readyWhen()) return; // printer timed the camera out: silence
			const f = this.nextFrame();
			const head = `${delim}\r\nContent-Type: image/jpeg\r\n${this.withLength ? `Content-Length: ${f.length}\r\n` : ''}\r\n`;
			res.write(head);
			res.write(f);
			res.write('\r\n');
		};
		send();
		const t = setInterval(send, Math.max(5, 1000 / this.fps));
		res.on('close', () => clearInterval(t));
	}
}
