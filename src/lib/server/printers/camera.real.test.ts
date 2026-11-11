/**
 * Opt-in probe against a real printer camera (read-only HTTP GETs on the camera port only):
 *   TMT_REAL_CAMERA=http://<your printer's address>:3031/video TMT_REAL_OUT=data/shots-camera/real-frame.jpg npx vitest run camera.real
 * Skipped unless TMT_REAL_CAMERA is set.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CameraHub } from './camera';
import { boundaryOf } from './mjpeg';

const url = process.env.TMT_REAL_CAMERA;
const out = process.env.TMT_REAL_OUT ?? 'data/shots-camera/real-frame.jpg';

describe.skipIf(!url)('real printer camera', () => {
	it('one snapshot through the hub, then up to 3 short concurrent GETs', async () => {
		const u = new URL(url!);
		const host = u.hostname;

		// Headers and framing of the real stream (no body bytes are printed).
		const probe = new AbortController();
		const r = await fetch(u, { signal: probe.signal });
		const ct = r.headers.get('content-type');
		const reader = r.body!.getReader();
		const first = (await reader.read()).value!;
		const head = Buffer.from(first.subarray(0, 300))
			.toString('latin1')
			.split(/\r?\n\r?\n/)[0];
		probe.abort();
		console.log('REAL status', r.status, 'content-type', ct, 'boundary', boundaryOf(ct));
		console.log('REAL first part headers:', JSON.stringify(head.replace(/[^\x20-\x7e\r\n]/g, '.')));

		const hub = new CameraHub({ lingerMs: 500, connectTimeoutMs: 5000, stallTimeoutMs: 8000 });
		const s = hub.session('real', async () => ({ urls: [u.toString()], origin: 'custom', host }));
		const f = await s.snapshot();
		writeFileSync(out, f.data);
		console.log('REAL frame bytes', f.data.length, 'saved to', out);
		expect(f.data[0]).toBe(0xff);

		// Concurrency: the hub holds one stream; add two more short raw GETs (3 total).
		const stop = s.watch(() => {});
		const extra = await Promise.all(
			[1, 2].map(async (i) => {
				const c = new AbortController();
				const t = setTimeout(() => c.abort(), 4000);
				try {
					const res = await fetch(u, { signal: c.signal });
					const rd = res.body!.getReader();
					const chunk = await rd.read();
					return `GET#${i + 1}: status ${res.status}, first chunk ${chunk.value?.length ?? 0} bytes`;
				} catch (e) {
					return `GET#${i + 1}: failed (${e instanceof Error ? e.name : 'error'})`;
				} finally {
					clearTimeout(t);
					c.abort();
				}
			})
		);
		console.log('REAL concurrency', extra.join(' | '), '| hub stream status:', s.status);
		stop();
		hub.closeAll();
	}, 30_000);
});
