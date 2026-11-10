import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { compressResponse } from './compress.ts';

const req = (enc = 'gzip, br', method = 'GET') =>
	new Request('http://x/', { method, headers: { 'accept-encoding': enc } });
const json = (n: number, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify({ a: 'x'.repeat(n) }), {
		headers: { 'content-type': 'application/json', ...headers }
	});

describe('compressResponse', () => {
	it('gzips a large JSON body and keeps it intact', async () => {
		const res = await compressResponse(req(), json(5000, { etag: '"e1"' }));
		expect(res.headers.get('content-encoding')).toBe('gzip');
		expect(res.headers.get('vary')).toMatch(/Accept-Encoding/i);
		expect(res.headers.get('etag')).toBe('"e1"');
		const raw = Buffer.from(await res.arrayBuffer());
		expect(Number(res.headers.get('content-length'))).toBe(raw.length);
		expect(JSON.parse(gunzipSync(raw).toString()).a).toHaveLength(5000);
	});
	it('leaves small bodies, other types, other methods and clients without gzip alone', async () => {
		expect((await compressResponse(req(), json(10))).headers.get('content-encoding')).toBeNull();
		expect(
			(await compressResponse(req('identity'), json(5000))).headers.get('content-encoding')
		).toBeNull();
		expect(
			(await compressResponse(req('gzip', 'POST'), json(5000))).headers.get('content-encoding')
		).toBeNull();
		const sse = new Response('data: x\n\n'.repeat(500), {
			headers: { 'content-type': 'text/event-stream' }
		});
		expect((await compressResponse(req(), sse)).headers.get('content-encoding')).toBeNull();
		const already = json(5000, { 'content-encoding': 'br' });
		expect((await compressResponse(req(), already)).headers.get('content-encoding')).toBe('br');
	});
	it('does not touch an empty 304', async () => {
		const res = new Response(null, { status: 304 });
		expect(await compressResponse(req(), res)).toBe(res);
	});
});
