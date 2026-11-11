import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { ApiError } from './access.ts';
import { readJson } from './api.ts';

const ev = (body: BodyInit | null, headers: Record<string, string> = {}) =>
	({
		request: new Request('http://x/api/x', {
			method: 'POST',
			body,
			headers,
			duplex: 'half'
		} as RequestInit)
	}) as unknown as RequestEvent;

const chunked = (parts: number) =>
	new ReadableStream<Uint8Array>({
		start(c) {
			for (let i = 0; i < parts; i++) c.enqueue(new TextEncoder().encode(' '.repeat(1000)));
			c.close();
		}
	});

describe('readJson', () => {
	it('parses a small body', async () => {
		expect(await readJson(ev('{"a":1}'))).toEqual({ a: 1 });
	});

	it('is 400 for invalid JSON and for an empty body', async () => {
		await expect(readJson(ev('{nope'))).rejects.toMatchObject({ status: 400 });
		await expect(readJson(ev(null))).rejects.toMatchObject({ status: 400 });
	});

	it('is 413 when the declared length is over the cap', async () => {
		const err = await readJson(ev('{}', { 'content-length': '5000' }), 1000).catch(
			(e: ApiError) => e
		);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).status).toBe(413);
	});

	it('is 413 for a body with no length that streams past the cap', async () => {
		const err = await readJson(ev(chunked(5)), 3000).catch((e: ApiError) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).status).toBe(413);
	});

	it('defaults to 1 MB', async () => {
		const ok = JSON.stringify({ s: 'x'.repeat(900 * 1024) });
		expect(await readJson(ev(ok))).toBeTruthy();
		const err = await readJson(ev(JSON.stringify({ s: 'x'.repeat(1100 * 1024) }))).catch(
			(e: ApiError) => e
		);
		expect((err as ApiError).status).toBe(413);
	});

	it('lets a route raise the cap', async () => {
		const big = JSON.stringify({ s: 'x'.repeat(1500 * 1024) });
		expect(await readJson(ev(big), 2 * 1024 * 1024)).toBeTruthy();
	});
});
