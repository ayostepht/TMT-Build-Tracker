import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeProjectThreeMf } from './fixtures';
import { receiveThreeMf } from './upload';

let dir = '';
const prev = { d: process.env.DATA_DIR, m: process.env.MAX_3MF_MB };
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'tmt-upload-'));
	process.env.DATA_DIR = dir;
});
afterAll(() => {
	if (prev.d === undefined) delete process.env.DATA_DIR;
	else process.env.DATA_DIR = prev.d;
	if (prev.m === undefined) delete process.env.MAX_3MF_MB;
	else process.env.MAX_3MF_MB = prev.m;
	rmSync(dir, { recursive: true, force: true });
});

const left = () => {
	const d = join(dir, 'uploads', '3mf');
	return existsSync(d) ? readdirSync(d) : [];
};
const post = (body: BodyInit | ReadableStream, headers: Record<string, string>) =>
	new Request('http://x/u', {
		method: 'POST',
		body: body as BodyInit,
		headers,
		// @ts-expect-error node fetch option
		duplex: 'half'
	});
const raw = { 'content-type': 'application/octet-stream' };

describe('receiveThreeMf', () => {
	it('refuses multipart with 415 without reading the body', async () => {
		const body = new ReadableStream({
			pull(c) {
				c.close();
			}
		});
		const req = post(body, { 'content-type': 'multipart/form-data; boundary=x' });
		await expect(receiveThreeMf(req, 'a.3mf')).rejects.toMatchObject({ status: 415 });
		expect(req.bodyUsed).toBe(false);
		expect(left()).toEqual([]);
	});

	it('refuses with 507 when the disk guard says no', async () => {
		await expect(
			receiveThreeMf(post(new Uint8Array([1]), raw), 'a.3mf', { hasRoom: () => false })
		).rejects.toMatchObject({ status: 507 });
		expect(left()).toEqual([]);
	});

	it('413 over the limit and leaves no file', async () => {
		process.env.MAX_3MF_MB = '1';
		try {
			const big = new Uint8Array(2 * 1048576);
			await expect(receiveThreeMf(post(big, raw), 'a.3mf')).rejects.toMatchObject({
				status: 413
			});
			expect(left()).toEqual([]);
			// Content-Length declared far over the limit is refused before a file exists
			const req = post(new Uint8Array(1), { ...raw, 'content-length': String(50 * 1048576) });
			await expect(receiveThreeMf(req, 'a.3mf')).rejects.toMatchObject({ status: 413 });
		} finally {
			delete process.env.MAX_3MF_MB;
		}
	});

	it('an aborted stream leaves no file', async () => {
		const body = new ReadableStream({
			start(c) {
				c.enqueue(new Uint8Array(1000));
			},
			pull() {
				throw new Error('connection reset');
			}
		});
		await expect(receiveThreeMf(post(body, raw), 'a.3mf')).rejects.toThrow();
		expect(left()).toEqual([]);
	});

	it('happy path parses a raw 3MF and removes the temp file', async () => {
		const bytes = makeProjectThreeMf({
			sliced: false,
			plates: [{ name: 'P1', objects: [{ name: 'PART A.step' }] }]
		});
		const r = await receiveThreeMf(post(bytes as BodyInit, raw), 'k.3mf');
		expect(r.fileName).toBe('k.3mf');
		expect(r.size).toBe(bytes.length);
		expect(r.summary.plates.length).toBeGreaterThan(0);
		expect(left()).toEqual([]);
	});
});
