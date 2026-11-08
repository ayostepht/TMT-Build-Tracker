import { afterEach, describe, expect, it } from 'vitest';
import { openDb, runMigrations } from '../db';
import { organization, user } from '../db/schema';
import { ApiError } from '../access';
import { CameraHub, CameraError, grabFrame, streamResponse } from './camera';
import { resolveCameraSource, type CameraSource, type CameraTarget } from './camera-source';
import { fakeJpeg, MockCamera } from './mock-camera';
import { boundaryOf, cleanJpeg, MjpegParser } from './mjpeg';
import { createPrinter, toPublic, updatePrinter } from './store';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	while (cleanup.length) await cleanup.pop()!();
});
async function until<T>(fn: () => T | undefined | false, ms = 4000): Promise<T> {
	const t0 = Date.now();
	for (;;) {
		const v = fn();
		if (v) return v;
		if (Date.now() - t0 > ms) throw new Error('timeout');
		await new Promise((r) => setTimeout(r, 10));
	}
}

/** Build a multipart body from frames. */
function body(
	frames: Buffer[],
	o: { delim?: string; length?: boolean; eol?: string; trailing?: boolean } = {}
): Buffer {
	const delim = o.delim ?? '--frame';
	const eol = o.eol ?? '\r\n';
	const parts = frames.map((f) =>
		Buffer.concat([
			Buffer.from(
				`${delim}${eol}Content-Type: image/jpeg${eol}${o.length === false ? '' : `Content-Length: ${f.length}${eol}`}${eol}`
			),
			f,
			Buffer.from(eol)
		])
	);
	return Buffer.concat([...parts, ...(o.trailing === false ? [] : [Buffer.from(delim)])]);
}
/** Feed in chunks of `n` bytes. */
function feed(p: MjpegParser, b: Buffer, n: number): Buffer[] {
	const out: Buffer[] = [];
	for (let i = 0; i < b.length; i += n) out.push(...p.push(b.subarray(i, i + n)));
	return out;
}
const A = fakeJpeg('AAAA', 200);
const B = fakeJpeg('BBBB', 333);
const C = fakeJpeg('CCCC', 50);

describe('MJPEG parser', () => {
	it('extracts the boundary parameter', () => {
		expect(boundaryOf('multipart/x-mixed-replace; boundary=frame')).toBe('frame');
		expect(boundaryOf('multipart/x-mixed-replace;boundary="--my foo"')).toBe('--my foo');
		expect(boundaryOf('multipart/x-mixed-replace; boundary=--foo; charset=x')).toBe('--foo');
		expect(boundaryOf('image/jpeg')).toBeNull();
		expect(boundaryOf(null)).toBeNull();
	});

	for (const [name, boundary, delim] of [
		['plain boundary', 'frame', '--frame'],
		['boundary that includes dashes', '--foo', '--foo'],
		['dashed boundary written with extra dashes', '--foo', '----foo']
	] as const) {
		for (const length of [true, false]) {
			for (const chunk of [1, 7, 4096]) {
				it(`${name}, Content-Length ${length ? 'present' : 'absent'}, ${chunk}-byte chunks`, () => {
					const p = new MjpegParser(boundary);
					const got = feed(p, body([A, B, C], { delim, length }), chunk);
					expect(got.map((f) => f.length)).toEqual(
						[A.length, B.length, C.length].slice(0, got.length)
					);
					// Without Content-Length the last frame is delivered once its delimiter arrives.
					expect(got.length).toBeGreaterThanOrEqual(2);
					expect(got[0].equals(A)).toBe(true);
					expect(got[1].equals(B)).toBe(true);
					if (got[2]) expect(got[2].equals(C)).toBe(true);
				});
			}
		}
	}

	it('delivers a length-less frame at once when the chunk ends right after its EOI', () => {
		const p = new MjpegParser('frame');
		const head = Buffer.from('--frame\r\nContent-Type: image/jpeg\r\n\r\n');
		expect(p.push(Buffer.concat([head, A]))).toHaveLength(1);
	});

	it('a delimiter split right after the frame does not lose the next frame', () => {
		const p = new MjpegParser('frame');
		const all = body([A, B], { length: false });
		const cut = all.indexOf(Buffer.from('--frame'), A.length) + 2; // mid-delimiter
		const got = [...p.push(all.subarray(0, cut)), ...p.push(all.subarray(cut))];
		expect(got.map((f) => f.length)).toEqual([A.length, B.length]);
	});

	it('works with LF-only line endings', () => {
		const p = new MjpegParser('frame');
		const got = feed(p, body([A, B], { eol: '\n' }), 5);
		expect(got.map((f) => f.length)).toEqual([A.length, B.length]);
	});

	it('skips preamble junk and non-JPEG parts', () => {
		const p = new MjpegParser('frame');
		const junk = Buffer.from('HTTP noise\r\n');
		const notJpeg = Buffer.from('this is not a jpeg at all');
		const got = p.push(Buffer.concat([junk, body([notJpeg, A])]));
		expect(got).toHaveLength(1);
		expect(got[0].equals(A)).toBe(true);
	});

	it('does not mistake an embedded EOI for the end when Content-Length is present', () => {
		const tricky = Buffer.concat([
			Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9, 3, 4, 5]),
			Buffer.from([0xff, 0xd9])
		]);
		const p = new MjpegParser('frame');
		const got = feed(p, body([tricky, A]), 3);
		expect(got[0].equals(tricky)).toBe(true);
	});

	it('refuses frames over the cap', () => {
		const p = new MjpegParser('frame', 100);
		const got = p.push(body([fakeJpeg('big', 500)]));
		expect(got).toHaveLength(0);
		expect(p.error).toMatch(/too large/);
		// and without a Content-Length
		const q = new MjpegParser('frame', 100);
		q.push(Buffer.from('--frame\r\n\r\n'));
		q.push(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(400, 1)]));
		expect(q.error).toMatch(/too large/);
	});

	it('cleanJpeg trims padding and rejects non-JPEG', () => {
		expect(cleanJpeg(Buffer.concat([A, Buffer.from([0, 0, 0])]))!.equals(A)).toBe(true);
		expect(cleanJpeg(Buffer.from('<html>'))).toBeNull();
	});
});

describe('camera source defaults', () => {
	const t = (o: Partial<CameraTarget>): CameraTarget => ({
		kind: 'elegoo-sdcp',
		host: '10.0.0.5',
		port: null,
		cameraUrl: null,
		cameraEnabled: true,
		secrets: {},
		...o
	});
	const jsonFetch =
		(payload: unknown, seen: { url?: string; headers?: unknown } = {}) =>
		async (url: string | URL | Request, init?: RequestInit) => {
			seen.url = String(url);
			seen.headers = init?.headers;
			return new Response(JSON.stringify(payload), { status: 200 });
		};

	it('Elegoo SDCP: http://<host>:3031/video, no network needed', async () => {
		const s = await resolveCameraSource(t({}), { fetchFn: () => Promise.reject(new Error('no')) });
		expect(s).toEqual({
			urls: ['http://10.0.0.5:3031/video'],
			origin: 'default',
			host: '10.0.0.5'
		});
	});
	it('a custom URL wins, but only on the printer host', async () => {
		const ok = await resolveCameraSource(t({ cameraUrl: 'http://10.0.0.5:8080/s' }));
		expect(ok?.origin).toBe('custom');
		expect(ok?.urls).toEqual(['http://10.0.0.5:8080/s']);
		expect(await resolveCameraSource(t({ cameraUrl: 'http://10.0.0.99/s' }))).toBeNull();
	});
	it('off and Bambu give no camera', async () => {
		expect(await resolveCameraSource(t({ cameraEnabled: false }))).toBeNull();
		expect(
			await resolveCameraSource(t({ kind: 'bambu-lan', cameraUrl: 'http://10.0.0.5/x' }))
		).toBeNull();
	});
	it('Moonraker: webcam list, relative URLs resolve against the host, foreign hosts dropped', async () => {
		const seen: { url?: string; headers?: unknown } = {};
		const fetchFn = jsonFetch(
			{
				result: {
					webcams: [
						{ enabled: false, stream_url: '/off/stream' },
						{
							enabled: true,
							stream_url: '/webcam/?action=stream',
							snapshot_url: 'http://evil.test/snap'
						}
					]
				}
			},
			seen
		);
		const s = await resolveCameraSource(
			t({ kind: 'moonraker', port: null, secrets: { apiKey: 'k' } }),
			{ fetchFn: fetchFn as typeof fetch }
		);
		expect(seen.url).toBe('http://10.0.0.5:7125/server/webcams/list');
		expect(s).toEqual({
			urls: ['http://10.0.0.5/webcam/?action=stream'],
			origin: 'moonraker',
			host: '10.0.0.5'
		});
	});
	it('Moonraker with no webcams, or an error: none', async () => {
		const none = await resolveCameraSource(t({ kind: 'moonraker' }), {
			fetchFn: jsonFetch({ result: { webcams: [] } }) as typeof fetch
		});
		expect(none).toBeNull();
		const err = await resolveCameraSource(t({ kind: 'moonraker' }), {
			fetchFn: (async () => new Response('x', { status: 500 })) as typeof fetch
		});
		expect(err).toBeNull();
	});
	it('OctoPrint: webcam settings with the API key, else none', async () => {
		const seen: { url?: string; headers?: unknown } = {};
		const payload = {
			webcam: { streamUrl: '/webcam/?action=stream', snapshotUrl: '/webcam/?action=snapshot' }
		};
		const s = await resolveCameraSource(t({ kind: 'octoprint', secrets: { apiKey: 'abc' } }), {
			fetchFn: jsonFetch(payload, seen) as typeof fetch
		});
		expect(seen.url).toBe('http://10.0.0.5:80/api/settings');
		expect(s?.urls).toEqual([
			'http://10.0.0.5/webcam/?action=stream',
			'http://10.0.0.5/webcam/?action=snapshot'
		]);
		expect(
			await resolveCameraSource(t({ kind: 'octoprint' }), {
				fetchFn: jsonFetch(payload) as typeof fetch
			})
		).toBeNull();
		const denied = await resolveCameraSource(t({ kind: 'octoprint', secrets: { apiKey: 'abc' } }), {
			fetchFn: (async () => new Response('', { status: 403 })) as typeof fetch
		});
		expect(denied).toBeNull();
	});
});

describe('saving a camera URL (SSRF guard)', () => {
	function setup() {
		const db = openDb(':memory:');
		runMigrations(db);
		db.insert(user).values({ id: 'u1', name: 'U', email: 'u@example.test' }).run();
		db.insert(organization).values({ id: 'o', name: 'O', slug: 'o', createdAt: new Date() }).run();
		return db;
	}
	const base = { name: 'P', kind: 'elegoo-sdcp', host: '10.0.0.5' };
	it('accepts same-host URLs, refuses everything else with 400', () => {
		const db = setup();
		const row = createPrinter(db, 'o', 'u1', { ...base, cameraUrl: 'http://10.0.0.5:8080/s' });
		expect(row.cameraUrl).toBe('http://10.0.0.5:8080/s');
		for (const bad of [
			'http://10.0.0.6/s',
			'http://169.254.169.254/',
			'file:///etc/passwd',
			'nonsense'
		]) {
			expect(() => createPrinter(db, 'o', 'u1', { ...base, cameraUrl: bad })).toThrow(ApiError);
			try {
				updatePrinter(db, row.id, 'o', { cameraUrl: bad });
			} catch (e) {
				expect((e as ApiError).status).toBe(400);
			}
		}
		expect(() => updatePrinter(db, row.id, 'o', { cameraUrl: 'http://10.0.0.6/s' })).toThrow(
			/same address/
		);
		// still the old value
		expect(updatePrinter(db, row.id, 'o', { name: 'Q' }).cameraUrl).toBe('http://10.0.0.5:8080/s');
	});
	it('blank clears; host change needs a matching camera; Bambu refuses', () => {
		const db = setup();
		const row = createPrinter(db, 'o', 'u1', { ...base, cameraUrl: 'http://10.0.0.5:8080/s' });
		expect(() => updatePrinter(db, row.id, 'o', { host: '10.0.0.7' })).toThrow(ApiError);
		const moved = updatePrinter(db, row.id, 'o', { host: '10.0.0.7', cameraUrl: '' });
		expect(moved.cameraUrl).toBeNull();
		expect(() =>
			createPrinter(db, 'o', 'u1', { ...base, kind: 'bambu-lan', cameraUrl: 'http://10.0.0.5/x' })
		).toThrow(/no camera support/);
	});
	it('only editors see the override in the public view', () => {
		const db = setup();
		const row = createPrinter(db, 'o', 'u1', {
			...base,
			cameraUrl: 'http://10.0.0.5:8080/s?token=abc'
		});
		expect(toPublic(row).cameraUrl).toBeNull();
		expect(toPublic(row, true).cameraUrl).toBe('http://10.0.0.5:8080/s?token=abc');
		expect(toPublic(row).cameraEnabled).toBe(true);
	});
});

describe('camera hub', () => {
	async function rig(
		mutate: (c: MockCamera) => void = () => {},
		opts: ConstructorParameters<typeof CameraHub>[0] = {}
	) {
		const cam = new MockCamera();
		mutate(cam);
		await cam.start();
		cleanup.push(() => cam.stop());
		const hub = new CameraHub({
			lingerMs: 80,
			pollMs: 30,
			connectTimeoutMs: 500,
			stallTimeoutMs: 400,
			backoffBaseMs: 20,
			backoffMaxMs: 60,
			...opts
		});
		cleanup.push(() => hub.closeAll());
		const src = (path = '/video'): CameraSource => ({
			urls: [cam.url(path)],
			origin: 'custom',
			host: '127.0.0.1'
		});
		return { cam, hub, src };
	}

	it('fans one upstream connection out to many viewers and keeps the latest frame', async () => {
		const { cam, hub, src } = await rig((c) => {
			c.frames = [fakeJpeg('one'), fakeJpeg('two'), fakeJpeg('three')];
		});
		const s = hub.session('p1', async () => src());
		const a: number[] = [];
		const b: number[] = [];
		const stopA = s.watch((f) => a.push(f.seq));
		const stopB = s.watch((f) => b.push(f.seq));
		await until(() => a.length >= 3 && b.length >= 3);
		expect(cam.total).toBe(1);
		expect(hub.session('p1', async () => src())).toBe(s);
		expect(s.viewers).toBe(2);
		expect(s.latest?.data.subarray(2, 5).toString()).toMatch(/one|two|thr/);
		const snap = await s.snapshot();
		expect(snap.data[0]).toBe(0xff);
		expect(cam.total).toBe(1);
		stopA();
		stopB();
	});

	it('closes the upstream about lingerMs after the last viewer and then removes the session', async () => {
		const { cam, hub, src } = await rig();
		const s = hub.session('p1', async () => src());
		const stop = s.watch(() => {});
		await until(() => s.latest);
		await until(() => cam.active === 1);
		stop();
		await new Promise((r) => setTimeout(r, 30));
		expect(cam.active).toBe(1); // still lingering
		await until(() => cam.active === 0);
		expect(s.status).toBe('idle');
		expect(hub.size).toBe(0);
		// a new viewer after teardown opens a fresh connection
		const s2 = hub.session('p1', async () => src());
		expect(s2).not.toBe(s);
		const stop2 = s2.watch(() => {});
		await until(() => s2.latest);
		expect(cam.total).toBe(2);
		stop2();
	});

	it('a new viewer during the linger window reuses the connection', async () => {
		const { cam, hub, src } = await rig();
		const s = hub.session('p1', async () => src());
		const stop = s.watch(() => {});
		await until(() => s.latest);
		stop();
		const stop2 = s.watch(() => {});
		await new Promise((r) => setTimeout(r, 150));
		expect(cam.total).toBe(1);
		expect(cam.active).toBe(1);
		stop2();
	});

	it('a snapshot request opens the upstream and keeps it for the linger period', async () => {
		const { cam, hub, src } = await rig();
		const s = hub.session('p1', async () => src());
		const f = await s.snapshot();
		expect(f.data.length).toBeGreaterThan(4);
		expect(cam.active).toBe(1);
		await until(() => cam.active === 0);
	});

	it('plain image/jpeg cameras are polled at the shared throttle, not per viewer', async () => {
		const { cam, hub, src } = await rig(
			(c) => {
				c.mode = 'jpeg';
			},
			{ pollMs: 100 }
		);
		const s = hub.session('p1', async () => src());
		const stops = [s.watch(() => {}), s.watch(() => {}), s.watch(() => {})];
		await new Promise((r) => setTimeout(r, 450));
		stops.forEach((x) => x());
		expect(cam.hits.filter((h) => h === '/video').length).toBeLessThanOrEqual(7);
		expect(cam.hits.length).toBeGreaterThanOrEqual(3);
		expect(s.latest).toBeTruthy();
	});

	it('error state: unreachable camera rejects and backs off; recovers when it comes back', async () => {
		const { cam, hub, src } = await rig((c) => {
			c.mode = 'error';
		});
		const s = hub.session('p1', async () => src());
		await expect(s.snapshot()).rejects.toThrow(CameraError);
		expect(s.status).toBe('error');
		const stop = s.watch(() => {});
		const before = cam.total;
		cam.mode = 'mjpeg';
		await until(() => s.status === 'live', 3000);
		expect(cam.total).toBeGreaterThan(before);
		stop();
	});

	it('a stalled stream goes to the error state after the stall timeout', async () => {
		const { hub, src } = await rig(
			(c) => {
				c.mode = 'stall';
			},
			{ stallTimeoutMs: 150 }
		);
		const s = hub.session('p1', async () => src());
		const stop = s.watch(() => {});
		await until(() => s.status === 'error', 2000);
		expect(s.lastError).toBeTruthy();
		stop();
	});

	it('refuses a redirect to another host and never fetches it', async () => {
		const { cam, hub } = await rig();
		const s = hub.session('p1', async () => ({
			urls: [cam.url('/video')],
			origin: 'custom' as const,
			host: '10.9.9.9' // not the camera's host
		}));
		await expect(s.snapshot()).rejects.toThrow(/away from the printer/);
		expect(cam.total).toBe(0);
	});

	it('falls back to the next URL when the first fails', async () => {
		const { hub, cam } = await rig();
		const s = hub.session('p1', async () => ({
			urls: [cam.url('/nope'), cam.url('/snapshot')],
			origin: 'moonraker' as const,
			host: '127.0.0.1'
		}));
		const f = await s.snapshot();
		expect(f.data[0]).toBe(0xff);
		expect(cam.hits[0]).toBe('/nope');
	});

	it('invalidate drops the connection at once', async () => {
		const { cam, hub, src } = await rig();
		const s = hub.session('p1', async () => src());
		const stop = s.watch(() => {});
		await until(() => s.latest);
		hub.invalidate('p1');
		await until(() => cam.active === 0);
		expect(hub.size).toBe(0);
		stop();
	});

	it('grabFrame fetches one frame without a hub', async () => {
		const { cam, src } = await rig();
		const f = await grabFrame(src());
		expect(f[0]).toBe(0xff);
		await until(() => cam.active === 0);
		const j = await grabFrame(src('/snapshot'));
		expect(j[1]).toBe(0xd8);
	});

	it('streamResponse sends multipart frames and releases the camera when the client aborts', async () => {
		const { cam, hub, src } = await rig(
			(c) => {
				c.frames = [fakeJpeg('x1'), fakeJpeg('x2')];
			},
			{ lingerMs: 20 }
		);
		const s = hub.session('p1', async () => src());
		const release = s.retain();
		await s.frame(3000, 2000);
		const ctl = new AbortController();
		const res = streamResponse(s, ctl.signal);
		release();
		expect(res.headers.get('content-type')).toMatch(/multipart\/x-mixed-replace; boundary=/);
		const reader = res.body!.getReader();
		const parser = new MjpegParser(/boundary=(.+)$/.exec(res.headers.get('content-type')!)![1]);
		const got: Buffer[] = [];
		while (got.length < 3) got.push(...parser.push((await reader.read()).value!));
		expect(got.every((g) => g[0] === 0xff && g[1] === 0xd8)).toBe(true);
		expect(s.viewers).toBe(1);
		ctl.abort();
		await until(() => s.viewers === 0);
		await until(() => cam.active === 0);
	});
});
