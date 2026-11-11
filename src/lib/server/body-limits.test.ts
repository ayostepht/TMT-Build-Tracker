import { afterEach, describe, expect, it } from 'vitest';
import {
	AUTH_BODY_CAP,
	BodyTooLargeError,
	DEFAULT_BODY_CAP,
	bodyCapFor,
	declaredLength,
	declaredTooLarge,
	limitRequest,
	limitStream,
	tooLargeResponse
} from './body-limits.ts';

const MB = 1024 * 1024;

afterEach(() => {
	delete process.env.MAX_3MF_MB;
	delete process.env.TMT_MODE;
});

describe('bodyCapFor', () => {
	it('gives ordinary JSON routes and form posts the small default', () => {
		expect(bodyCapFor('POST', '/api/builds').cap).toBe(DEFAULT_BODY_CAP);
		expect(bodyCapFor('PATCH', '/api/builds/abc/parts/p1/status').cap).toBe(DEFAULT_BODY_CAP);
		expect(bodyCapFor('POST', '/teams/x/members').cap).toBe(DEFAULT_BODY_CAP);
		expect(DEFAULT_BODY_CAP).toBe(1 * MB);
	});

	it('follows MAX_3MF_MB for the 3MF upload routes, plus framing', () => {
		expect(bodyCapFor('POST', '/api/builds/b1/plates/upload').cap).toBe(1024 * MB + MB);
		process.env.MAX_3MF_MB = '300';
		expect(bodyCapFor('POST', '/api/builds/b1/plates/upload').cap).toBe(301 * MB);
		expect(bodyCapFor('POST', '/api/templates/t1/print-geometry').cap).toBe(301 * MB);
	});

	it('uses the 256 MB default in public mode, and an explicit MAX_3MF_MB still wins', () => {
		process.env.TMT_MODE = 'public';
		expect(bodyCapFor('POST', '/api/builds/b1/plates/upload').cap).toBe(257 * MB);
		expect(bodyCapFor('POST', '/api/templates/t1/print-geometry').cap).toBe(257 * MB);
		process.env.MAX_3MF_MB = '512';
		expect(bodyCapFor('POST', '/api/builds/b1/plates/upload').cap).toBe(513 * MB);
	});

	it('allows STEP zips 200 MB, photos 9 MB, guide pages 3 MB, snapshots 2 MB', () => {
		expect(bodyCapFor('POST', '/api/templates/t1/model').cap).toBe(201 * MB);
		expect(bodyCapFor('POST', '/api/builds/b1/photos').cap).toBe(9 * MB + 64 * 1024);
		expect(bodyCapFor('POST', '/api/templates/t1/guide/pages/4').cap).toBe(3 * MB);
		expect(bodyCapFor('PUT', '/api/designs/d1/snapshot').cap).toBe(2 * MB);
	});

	it('keeps sign-in requests tiny', () => {
		expect(bodyCapFor('POST', '/api/auth/sign-in/email').cap).toBe(AUTH_BODY_CAP);
	});

	it('does not let a big-body route lend its cap to a lookalike path or method', () => {
		expect(bodyCapFor('POST', '/api/builds/b1/plates/upload/u1/apply').cap).toBe(DEFAULT_BODY_CAP);
		expect(bodyCapFor('DELETE', '/api/templates/t1/print-geometry').cap).toBe(DEFAULT_BODY_CAP);
		expect(bodyCapFor('POST', '/api/templates/t1/model/jobs/j1').cap).toBe(DEFAULT_BODY_CAP);
		expect(bodyCapFor('GET', '/api/designs/d1/snapshot').cap).toBe(DEFAULT_BODY_CAP);
		expect(bodyCapFor('POST', '/api/designs/d1/snapshot').cap).toBe(DEFAULT_BODY_CAP);
	});
});

describe('declared length', () => {
	const h = (v?: string) => new Headers(v === undefined ? {} : { 'content-length': v });
	it('reads plain numbers only', () => {
		expect(declaredLength(h('123'))).toBe(123);
		expect(declaredLength(h())).toBeNull();
		expect(declaredLength(h('12abc'))).toBeNull();
		expect(declaredLength(h('-1'))).toBeNull();
	});
	it('flags only lengths over the cap', () => {
		expect(declaredTooLarge(h(String(MB)), MB)).toBe(false);
		expect(declaredTooLarge(h(String(MB + 1)), MB)).toBe(true);
		expect(declaredTooLarge(h(), MB)).toBe(false);
	});
});

const streamOf = (chunks: Uint8Array[]) =>
	new ReadableStream<Uint8Array>({
		start(c) {
			for (const ch of chunks) c.enqueue(ch);
			c.close();
		}
	});
const bytes = (n: number) => new Uint8Array(n).fill(97);

async function readAll(s: ReadableStream<Uint8Array>) {
	const r = s.getReader();
	let n = 0;
	for (;;) {
		const { done, value } = await r.read();
		if (done) return n;
		n += value.byteLength;
	}
}

describe('limitStream', () => {
	it('passes a body at the cap through untouched', async () => {
		const { stream, exceeded } = limitStream(streamOf([bytes(60), bytes(40)]), 100);
		expect(await readAll(stream)).toBe(100);
		expect(exceeded()).toBe(false);
	});

	it('errors with a 413 ApiError as soon as the cap is passed', async () => {
		const { stream, exceeded } = limitStream(streamOf([bytes(60), bytes(60), bytes(60)]), 100);
		const err = await readAll(stream).catch((e) => e);
		expect(err).toBeInstanceOf(BodyTooLargeError);
		expect((err as BodyTooLargeError).status).toBe(413);
		expect(exceeded()).toBe(true);
	});

	it('does not cancel the source at the cap (the connection must survive to carry the 413)', async () => {
		let cancelled = false;
		let sent = 0;
		const source = new ReadableStream<Uint8Array>({
			pull(c) {
				if (sent >= 5) return c.close();
				sent++;
				c.enqueue(bytes(60));
			},
			cancel() {
				cancelled = true;
			}
		});
		const { stream } = limitStream(source, 100);
		await readAll(stream).catch(() => {});
		await new Promise((r) => setTimeout(r, 20));
		expect(cancelled).toBe(false);
		expect(sent).toBe(5); // drained, not buffered
	});

	it('stops draining and cancels the source once a client keeps sending far past the cap', async () => {
		let cancelled = false;
		const source = new ReadableStream<Uint8Array>({
			pull(c) {
				c.enqueue(bytes(1024));
			},
			cancel() {
				cancelled = true;
			}
		});
		const { stream } = limitStream(source, 100, 4096);
		await readAll(stream).catch(() => {});
		await new Promise((r) => setTimeout(r, 50));
		expect(cancelled).toBe(true);
	});
});

describe('limitRequest', () => {
	const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
		new Request('http://x/api/builds', {
			method: 'POST',
			body,
			headers,
			duplex: 'half'
		} as RequestInit);

	it('lets json() and text() read a body under the cap', async () => {
		const { request } = limitRequest(
			post(JSON.stringify({ a: 1 }), { 'content-type': 'application/json' }),
			100
		);
		expect(await request.json()).toEqual({ a: 1 });
	});

	it('lets formData() read a form under the cap', async () => {
		const fd = new FormData();
		fd.set('name', 'x');
		const { request } = limitRequest(post(fd), 10_000);
		expect((await request.formData()).get('name')).toBe('x');
	});

	it('makes json() fail on a body over the cap, chunked or not', async () => {
		const big = new ReadableStream<Uint8Array>({
			start(c) {
				for (let i = 0; i < 10; i++) c.enqueue(bytes(50));
				c.close();
			}
		});
		const { request, exceeded } = limitRequest(
			post(big, { 'content-type': 'application/json' }),
			100
		);
		await expect(request.json()).rejects.toBeInstanceOf(BodyTooLargeError);
		expect(exceeded()).toBe(true);
	});

	it('keeps method, headers and a streaming body for upload handlers', async () => {
		const { request } = limitRequest(post(streamOf([bytes(30), bytes(30)]), { 'x-a': '1' }), 100);
		expect(request.method).toBe('POST');
		expect(request.headers.get('x-a')).toBe('1');
		expect(await readAll(request.body!)).toBe(60);
	});

	it('returns requests without a body unchanged', () => {
		const get = new Request('http://x/');
		expect(limitRequest(get, 10).request).toBe(get);
	});
});

describe('tooLargeResponse', () => {
	it('is a 413 with a plain message, JSON for the API', async () => {
		const j = tooLargeResponse(MB, true, true);
		expect(j.status).toBe(413);
		expect(await j.json()).toEqual({ error: 'The request is larger than 1 MB' });
		expect(j.headers.get('connection')).toBe('close');
		const t = tooLargeResponse(64 * 1024, false, false);
		expect(await t.text()).toBe('The request is larger than 64 kB');
		expect(t.headers.get('content-type')).toMatch(/text\/plain/);
	});
});
