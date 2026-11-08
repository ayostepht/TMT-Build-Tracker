/**
 * Camera hub: one upstream connection per printer, fanned out to every browser. Opened on the
 * first viewer or snapshot request, keeps the latest JPEG frame, closed `lingerMs` after the last
 * one leaves. Read-only: only HTTP GETs to URLs that passed the same-host guard (also on
 * redirects). Nothing here logs URLs or response bodies.
 */
import { checkCameraUrl } from '#lib/printers/camera-url.ts';
import type { CameraSource } from './camera-source';
import { boundaryOf, cleanJpeg, MAX_FRAME_BYTES, MjpegParser } from './mjpeg';
import { backoff } from './types';

export interface Frame {
	data: Buffer;
	at: number;
	seq: number;
}

export interface HubOptions {
	connectTimeoutMs: number;
	stallTimeoutMs: number;
	lingerMs: number;
	/** Interval between fetches for plain image/jpeg cameras (shared by all viewers). */
	pollMs: number;
	maxFrameBytes: number;
	backoffBaseMs: number;
	backoffMaxMs: number;
	fetchFn: typeof fetch;
}

export const DEFAULT_HUB_OPTIONS: HubOptions = {
	connectTimeoutMs: 5000,
	stallTimeoutMs: 15000,
	lingerMs: 30000,
	pollMs: 1000,
	maxFrameBytes: MAX_FRAME_BYTES,
	backoffBaseMs: 1000,
	backoffMaxMs: 30000,
	fetchFn: (...a) => fetch(...a)
};

export class CameraError extends Error {}

export type SessionStatus = 'idle' | 'connecting' | 'live' | 'error';

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		const t = setTimeout(done, ms);
		signal.addEventListener('abort', done, { once: true });
		function done() {
			clearTimeout(t);
			signal.removeEventListener('abort', done);
			resolve();
		}
	});

/** GET one camera URL with a connect timeout, following (guarded) redirects by hand. */
export async function openUpstream(
	url: string,
	host: string,
	signal: AbortSignal,
	o: Pick<HubOptions, 'connectTimeoutMs' | 'fetchFn'>
): Promise<Response> {
	let target = url;
	for (let hop = 0; hop < 4; hop++) {
		const c = checkCameraUrl(target, host);
		if (!c.ok) throw new CameraError('Camera redirected away from the printer');
		const ctl = new AbortController(); // connect timeout only; the caller's signal governs the body
		const timer = setTimeout(() => ctl.abort(), o.connectTimeoutMs);
		let res: Response;
		try {
			res = await o.fetchFn(c.url, {
				method: 'GET',
				redirect: 'manual',
				signal: AbortSignal.any([signal, ctl.signal]),
				headers: { accept: 'multipart/x-mixed-replace, image/jpeg, */*' }
			});
		} catch {
			throw new CameraError(signal.aborted ? 'Closed' : 'Could not reach the camera');
		} finally {
			clearTimeout(timer);
		}
		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get('location');
			await res.body?.cancel().catch(() => {});
			if (!loc) throw new CameraError('Camera redirect without a location');
			target = new URL(loc, c.url).toString();
			continue;
		}
		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
			throw new CameraError(`Camera answered ${res.status}`);
		}
		return res;
	}
	throw new CameraError('Camera redirected too many times');
}

/** Read a whole (small) body, at most `max` bytes. */
async function readCapped(res: Response, max: number, timeoutMs: number): Promise<Buffer> {
	const reader = res.body?.getReader();
	if (!reader) throw new CameraError('Camera sent no data');
	const parts: Buffer[] = [];
	let n = 0;
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		void reader.cancel().catch(() => {});
	}, timeoutMs);
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			n += value.length;
			if (n > max) {
				await reader.cancel().catch(() => {});
				throw new CameraError('Camera frame too large');
			}
			parts.push(Buffer.from(value));
		}
	} finally {
		clearTimeout(timer);
	}
	if (timedOut) throw new CameraError('Camera stalled');
	return Buffer.concat(parts);
}

const isMultipart = (ct: string | null) => !!ct && /multipart\/x-mixed-replace/i.test(ct);

/**
 * Fetch one frame straight from a source (no hub): used by the settings "Test" button.
 * Tries each URL in order.
 */
export async function grabFrame(
	source: CameraSource,
	opts: Partial<HubOptions> = {}
): Promise<Buffer> {
	const o = { ...DEFAULT_HUB_OPTIONS, ...opts };
	let last: unknown = new CameraError('No camera');
	for (const url of source.urls) {
		const ctl = new AbortController();
		const kill = setTimeout(() => ctl.abort(), o.connectTimeoutMs + o.stallTimeoutMs);
		try {
			const res = await openUpstream(url, source.host, ctl.signal, o);
			const ct = res.headers.get('content-type');
			if (isMultipart(ct)) {
				const b = boundaryOf(ct);
				if (!b) throw new CameraError('Camera stream has no boundary');
				const parser = new MjpegParser(b, o.maxFrameBytes);
				const reader = res.body!.getReader();
				for (;;) {
					const { done, value } = await reader.read();
					if (done) throw new CameraError('Camera stream ended');
					const frames = parser.push(value);
					if (parser.error) throw new CameraError(parser.error);
					if (frames.length) return frames[0];
				}
			}
			const jpg = cleanJpeg(await readCapped(res, o.maxFrameBytes, o.stallTimeoutMs));
			if (!jpg) throw new CameraError('The camera did not send a JPEG image');
			return jpg;
		} catch (e) {
			last = e;
		} finally {
			clearTimeout(kill);
			ctl.abort();
		}
	}
	throw last instanceof CameraError ? last : new CameraError('Could not reach the camera');
}

/** One printer's shared upstream connection. */
export class CameraSession {
	status: SessionStatus = 'idle';
	lastError: string | null = null;
	latest: Frame | null = null;
	private refs = 0;
	private seq = 0;
	private frameCbs = new Set<(f: Frame) => void>();
	private stateCbs = new Set<() => void>();
	private linger: ReturnType<typeof setTimeout> | undefined;
	private abort: AbortController | null = null;
	/** Number of upstream connections opened so far (tests, diagnostics). */
	connects = 0;

	constructor(
		private resolver: () => Promise<CameraSource | null>,
		private opts: HubOptions,
		private onClosed: () => void = () => {}
	) {}

	/** Count a viewer; the upstream connection opens with the first one. Returns release. */
	retain(): () => void {
		this.refs++;
		clearTimeout(this.linger);
		if (!this.abort) this.start();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.refs--;
			if (this.refs === 0) {
				clearTimeout(this.linger);
				this.linger = setTimeout(() => this.close(), this.opts.lingerMs);
			}
		};
	}

	get viewers() {
		return this.refs;
	}

	/** Retain plus a frame callback; returns stop. */
	watch(onFrame: (f: Frame) => void, onState?: () => void): () => void {
		const release = this.retain();
		this.frameCbs.add(onFrame);
		if (onState) this.stateCbs.add(onState);
		return () => {
			this.frameCbs.delete(onFrame);
			if (onState) this.stateCbs.delete(onState);
			release();
		};
	}

	/** Resolve with a frame no older than `maxAgeMs`, waiting up to `waitMs` for one. */
	frame(maxAgeMs: number, waitMs: number): Promise<Frame> {
		const fresh = this.latest && Date.now() - this.latest.at <= maxAgeMs ? this.latest : null;
		if (fresh) return Promise.resolve(fresh);
		if (this.status === 'error')
			return Promise.reject(new CameraError(this.lastError ?? 'Camera unavailable'));
		return new Promise((resolve, reject) => {
			const fin = () => {
				clearTimeout(t);
				this.frameCbs.delete(onFrame);
				this.stateCbs.delete(onState);
			};
			const onFrame = (f: Frame) => (fin(), resolve(f));
			const onState = () => {
				if (this.status === 'error' || this.status === 'idle') {
					fin();
					reject(new CameraError(this.lastError ?? 'Camera unavailable'));
				}
			};
			const t = setTimeout(() => (fin(), reject(new CameraError('Camera timed out'))), waitMs);
			this.frameCbs.add(onFrame);
			this.stateCbs.add(onState);
		});
	}

	/** A snapshot: counts as a viewer while it waits, so the connection lingers afterwards. */
	async snapshot(): Promise<Frame> {
		const release = this.retain();
		try {
			return await this.frame(3000, this.opts.connectTimeoutMs + 5000);
		} finally {
			release();
		}
	}

	close() {
		clearTimeout(this.linger);
		this.abort?.abort();
		this.abort = null;
		this.setStatus('idle');
		this.latest = null;
		this.onClosed();
	}

	private setStatus(s: SessionStatus, err?: string) {
		this.status = s;
		if (err !== undefined) this.lastError = err;
		for (const cb of [...this.stateCbs]) cb();
	}

	private publish(data: Buffer) {
		const f: Frame = { data, at: Date.now(), seq: ++this.seq };
		this.latest = f;
		this.status = 'live';
		this.lastError = null;
		for (const cb of [...this.frameCbs]) {
			try {
				cb(f);
			} catch {
				/* a viewer bug must not kill the stream */
			}
		}
	}

	private start() {
		const ctl = new AbortController();
		this.abort = ctl;
		void this.loop(ctl.signal);
	}

	private async loop(signal: AbortSignal) {
		let attempt = 0;
		while (!signal.aborted) {
			this.setStatus('connecting');
			let got = false;
			try {
				const src = await this.resolver();
				if (signal.aborted) return;
				if (!src) throw new CameraError('No camera for this printer');
				got = await this.consumeAny(src, signal);
			} catch (e) {
				if (signal.aborted) return;
				this.setStatus('error', e instanceof CameraError ? e.message : 'Camera unavailable');
			}
			if (signal.aborted) return;
			if (got) attempt = 0;
			if (this.status !== 'error') this.setStatus('error', 'Camera stream ended');
			await sleep(backoff(attempt++, this.opts.backoffBaseMs, this.opts.backoffMaxMs), signal);
		}
	}

	/** Try the source's URLs in order; true when frames flowed before it ended. */
	private async consumeAny(src: CameraSource, signal: AbortSignal): Promise<boolean> {
		let last: unknown;
		for (const url of src.urls) {
			try {
				return await this.consume(url, src.host, signal);
			} catch (e) {
				if (signal.aborted) throw e;
				last = e;
			}
		}
		throw last instanceof CameraError ? last : new CameraError('Could not reach the camera');
	}

	private async consume(url: string, host: string, signal: AbortSignal): Promise<boolean> {
		this.connects++;
		const res = await openUpstream(url, host, signal, this.opts);
		const ct = res.headers.get('content-type');
		let frames = 0;
		if (isMultipart(ct)) {
			const b = boundaryOf(ct);
			if (!b) throw new CameraError('Camera stream has no boundary');
			const parser = new MjpegParser(b, this.opts.maxFrameBytes);
			const reader = res.body!.getReader();
			let stall: ReturnType<typeof setTimeout> | undefined;
			let stalled = false;
			const arm = () => {
				clearTimeout(stall);
				stall = setTimeout(() => {
					stalled = true;
					void reader.cancel().catch(() => {});
				}, this.opts.stallTimeoutMs);
			};
			arm();
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					arm();
					for (const f of parser.push(value)) {
						frames++;
						this.publish(f);
					}
					if (parser.error) throw new CameraError(parser.error);
				}
			} catch (e) {
				if (signal.aborted) throw e;
				if (e instanceof CameraError) throw e;
				stalled = true; // network error mid-stream
			} finally {
				clearTimeout(stall);
				void reader.cancel().catch(() => {});
			}
			if (stalled || frames === 0)
				throw new CameraError(frames === 0 ? 'Camera sent no frames' : 'Camera stream stopped');
			return true;
		}
		// Plain JPEG: this response is frame one, then poll (throttled, shared by all viewers).
		let jpg = cleanJpeg(await readCapped(res, this.opts.maxFrameBytes, this.opts.stallTimeoutMs));
		for (;;) {
			if (!jpg) throw new CameraError('The camera did not send a JPEG image');
			frames++;
			this.publish(jpg);
			await sleep(this.opts.pollMs, signal);
			if (signal.aborted) return frames > 0;
			const r = await openUpstream(url, host, signal, this.opts);
			jpg = cleanJpeg(await readCapped(r, this.opts.maxFrameBytes, this.opts.stallTimeoutMs));
		}
	}
}

/** Sessions per printer. */
export class CameraHub {
	private sessions = new Map<string, CameraSession>();
	readonly opts: HubOptions;
	constructor(opts: Partial<HubOptions> = {}) {
		this.opts = { ...DEFAULT_HUB_OPTIONS, ...opts };
	}

	session(printerId: string, resolver: () => Promise<CameraSource | null>): CameraSession {
		let s = this.sessions.get(printerId);
		if (!s) {
			const created: CameraSession = new CameraSession(resolver, this.opts, () => {
				if (this.sessions.get(printerId) === created) this.sessions.delete(printerId);
			});
			s = created;
			this.sessions.set(printerId, s);
		}
		return s;
	}

	/** The printer's camera settings changed or it was deleted: drop its connection now. */
	invalidate(printerId: string) {
		this.sessions.get(printerId)?.close();
	}

	get size() {
		return this.sessions.size;
	}

	closeAll() {
		for (const s of [...this.sessions.values()]) s.close();
	}
}

let hub: CameraHub | undefined;
export const getCameraHub = (): CameraHub => (hub ??= new CameraHub());

const OUT_BOUNDARY = 'tmtframe';

/**
 * A `multipart/x-mixed-replace` response for one browser. Slow readers skip frames (latest wins);
 * the stream ends when the browser leaves or the camera fails, which closes the viewer's hold.
 */
export function streamResponse(session: CameraSession, signal: AbortSignal): Response {
	const enc = new TextEncoder();
	let pending: Frame | null = null;
	let wake: (() => void) | null = null;
	let ended = false;
	let stop: () => void = () => {};
	const end = (ctl?: ReadableStreamDefaultController<Uint8Array>) => {
		if (ended) return;
		ended = true;
		stop();
		wake?.();
		try {
			ctl?.close();
		} catch {
			/* already closed */
		}
	};
	const body = new ReadableStream<Uint8Array>(
		{
			start(ctl) {
				pending = session.latest;
				stop = session.watch(
					(f) => {
						pending = f;
						wake?.();
					},
					() => {
						if (session.status === 'error' || session.status === 'idle') end(ctl);
					}
				);
				signal.addEventListener('abort', () => end(ctl), { once: true });
				if (signal.aborted) end(ctl);
			},
			async pull(ctl) {
				while (!pending && !ended) await new Promise<void>((r) => (wake = r));
				wake = null;
				if (ended) return;
				const f = pending!;
				pending = null;
				ctl.enqueue(
					Buffer.concat([
						enc.encode(
							`--${OUT_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.data.length}\r\n\r\n`
						),
						f.data,
						enc.encode('\r\n')
					])
				);
			},
			cancel() {
				end();
			}
		},
		{ highWaterMark: 0 }
	);
	return new Response(body, {
		headers: {
			'content-type': `multipart/x-mixed-replace; boundary=${OUT_BOUNDARY}`,
			'cache-control': 'no-store',
			'x-accel-buffering': 'no',
			connection: 'keep-alive'
		}
	});
}
