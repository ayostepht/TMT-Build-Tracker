import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { ApiError } from './access.ts';
import { readJson, respond, safeErrorText } from './api.ts';

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

describe('respond error logging', () => {
	it('logs name and message but never the bound parameters', async () => {
		const err = Object.assign(
			new Error('Failed query: select * from "user" where email = $1\nparams: secret@example.test'),
			{
				name: 'DrizzleQueryError',
				params: ['secret@example.test'],
				cause: new Error('secret@example.test')
			}
		);
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const res = await respond(() => {
			throw err;
		});
		expect(res.status).toBe(500);
		const logged = JSON.stringify(spy.mock.calls);
		spy.mockRestore();
		expect(logged).toContain('DrizzleQueryError');
		expect(logged).toContain('Failed query');
		expect(logged).not.toContain('secret@example.test');
		expect(safeErrorText('x')).toBe('non-error thrown');
	});
});

describe('safeErrorText', () => {
	it('drops params, cause and collapses newlines and control characters', () => {
		const err = Object.assign(
			new Error('line one\nFAKE [tmt] line\r\u001b[31mred\nparams: a@b.test'),
			{
				cause: new Error('cause-secret')
			}
		);
		const text = safeErrorText(err);
		const first = text.split('\n')[0];
		expect(first).toBe('Error: line one FAKE [tmt] line [31mred');
		expect(text).not.toContain('a@b.test');
		expect(text).not.toContain('cause-secret');
		expect(text.split('\n').every((l, i) => i === 0 || /^\s+at /.test(l))).toBe(true);
	});

	it('does not let a message forge stack frames or leak params, and caps frames', () => {
		const err = new Error('boom\nparams: x\n  at evil (forged)');
		const real = Array.from({ length: 30 }, (_, i) => `    at real${i} (file.ts:${i}:1)`);
		err.stack = `${err.name}: ${err.message}\n${real.join('\n')}`;
		const text = safeErrorText(err);
		expect(text).not.toContain('forged');
		expect(text).not.toContain('evil');
		expect(text).not.toContain('params');
		expect(text).toContain('at real0 ');
		expect(text.split('\n').length).toBeLessThanOrEqual(11);
	});
});
