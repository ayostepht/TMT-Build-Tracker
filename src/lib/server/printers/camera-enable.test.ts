import { afterEach, describe, expect, it } from 'vitest';
import {
	cameraOnEnvelope,
	enableSdcpCamera,
	SDCP_ALLOWED_COMMANDS,
	SDCP_READ_COMMANDS,
	sdcpEnvelope
} from './adapters/sdcp';
import { adapters } from './adapters';
import { CameraHub, CameraError, grabFrame } from './camera';
import type { CameraSource } from './camera-source';
import { MockCamera } from './mock-camera';
import { MockSdcp } from './mock-sdcp';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	while (cleanup.length) await cleanup.pop()!();
});
async function until<T>(fn: () => T | undefined | false, ms = 6000): Promise<T> {
	const t0 = Date.now();
	for (;;) {
		const v = fn();
		if (v) return v;
		if (Date.now() - t0 > ms) throw new Error('timeout');
		await new Promise((r) => setTimeout(r, 10));
	}
}

describe('SDCP write allowlist', () => {
	it('the only write command is 386, with the one payload {Enable:1}', () => {
		expect([...SDCP_ALLOWED_COMMANDS]).toEqual([386]);
		expect([...SDCP_READ_COMMANDS]).toEqual([0, 1]);
		const env = JSON.parse(cameraOnEnvelope('MB1'));
		expect(env.Topic).toBe('sdcp/request/MB1');
		expect(env.Data).toMatchObject({ Cmd: 386, Data: { Enable: 1 }, MainboardID: 'MB1', From: 1 });
		expect(typeof env.Data.RequestID).toBe('string');
		expect(typeof env.Data.TimeStamp).toBe('number');
	});
	it('any other command id throws (print start/pause/stop/move/heat and everything else)', () => {
		for (let cmd = -5; cmd <= 2000; cmd++) {
			if (cmd === 0 || cmd === 1 || cmd === 386) continue;
			expect(() => sdcpEnvelope(cmd, {}, 'MB'), String(cmd)).toThrow(/not allowed/);
			expect(() => sdcpEnvelope(cmd, { Enable: 1 }, 'MB'), String(cmd)).toThrow(/not allowed/);
		}
		for (const cmd of [128, 129, 130, 131, 132, 133, 134, 135, 192, 255, 403])
			expect(() => sdcpEnvelope(cmd, { Enable: 1 }, 'MB')).toThrow();
		expect(() => sdcpEnvelope(Number.NaN, {}, 'MB')).toThrow();
	});
	it('386 refuses any payload but {Enable:1}; reads take no data', () => {
		for (const d of [{}, { Enable: 0 }, { Enable: 1, Extra: 1 }, { Enable: '1' }])
			expect(() => sdcpEnvelope(386, d, 'MB')).toThrow(/payload/);
		expect(() => sdcpEnvelope(0, { Enable: 1 }, 'MB')).toThrow(/no data/);
		expect(() => sdcpEnvelope(1, {}, 'MB')).not.toThrow();
	});
});

describe('camera-on over SDCP', () => {
	const cfg = (port: number) => ({
		id: 'p',
		kind: 'elegoo-sdcp' as const,
		host: '127.0.0.1',
		port,
		secrets: { mainboardId: 'ABCDEF' }
	});

	it('uses the supervisor socket when it is open: no second client', async () => {
		const mock = new MockSdcp();
		await mock.start();
		cleanup.push(() => mock.stop());
		const h = adapters['elegoo-sdcp'](cfg(mock.port));
		cleanup.push(() => h.close());
		await until(() => mock.received.length >= 2 && mock.sockets.size === 1);
		expect(await h.enableCamera!()).toBe(true);
		await until(() => mock.received.some((r) => r.cmd === 386));
		expect(mock.received.find((r) => r.cmd === 386)?.data).toEqual({ Enable: 1 });
		expect(mock.sockets.size).toBe(1);
		expect(mock.cameraReady()).toBe(true);
		// Everything the adapter sent: status/attributes reads and the one camera-on.
		expect(mock.received.every((r) => [0, 1, 386].includes(r.cmd))).toBe(true);
	});

	it('opens a temporary socket when none is open, then closes it', async () => {
		const mock = new MockSdcp();
		await mock.start();
		cleanup.push(() => mock.stop());
		expect(mock.cameraReady()).toBe(false);
		expect(await enableSdcpCamera(cfg(mock.port), { settleMs: 50 })).toBe(true);
		expect(mock.received).toEqual([{ cmd: 386, data: { Enable: 1 } }]);
		expect(mock.cameraReady()).toBe(true);
		await until(() => mock.sockets.size === 0);
	});

	it('mock camera falls back to not ready after its timeout', async () => {
		const mock = new MockSdcp();
		mock.cameraTimeoutMs = 80;
		await mock.start();
		cleanup.push(() => mock.stop());
		await enableSdcpCamera(cfg(mock.port), { settleMs: 20 });
		expect(mock.cameraReady()).toBe(true);
		await new Promise((r) => setTimeout(r, 120));
		expect(mock.cameraReady()).toBe(false);
	});

	it('reports false when the printer is unreachable', async () => {
		expect(await enableSdcpCamera(cfg(1), { timeoutMs: 500 })).toBe(false);
	});
});

describe('camera hub enables the printer camera', () => {
	async function rig(hubOpts: ConstructorParameters<typeof CameraHub>[0] = {}) {
		const cam = new MockCamera();
		let ready = false;
		let sends = 0;
		cam.readyWhen = () => ready;
		await cam.start();
		cleanup.push(() => cam.stop());
		const hub = new CameraHub({
			lingerMs: 80,
			pollMs: 30,
			connectTimeoutMs: 500,
			stallTimeoutMs: 300,
			backoffBaseMs: 20,
			backoffMaxMs: 60,
			enableRetryMs: 40,
			enableWaitMs: 2000,
			...hubOpts
		});
		cleanup.push(() => hub.closeAll());
		const src: CameraSource = { urls: [cam.url()], origin: 'default', host: '127.0.0.1' };
		/** The "printer": camera is ready 100 ms after a camera-on. */
		const send = async () => {
			sends++;
			setTimeout(() => (ready = true), 100);
			return true;
		};
		return {
			cam,
			hub,
			src,
			send,
			sends: () => sends,
			setReady: (v: boolean) => (ready = v)
		};
	}

	it('not ready -> enable -> frames', async () => {
		const { cam, hub, src, send, sends } = await rig();
		const s = hub.session('p1', async () => src, send);
		const stop = s.watch(() => {});
		await until(() => s.latest);
		expect(s.status).toBe('live');
		expect(cam.hits.length).toBeGreaterThanOrEqual(2); // first answer was 500, then retried
		expect(sends()).toBe(1);
		stop();
	});

	it('a snapshot with the camera off turns it on and returns a frame', async () => {
		const { hub, src, send, sends } = await rig();
		const s = hub.session('p1', async () => src, send);
		const f = await s.snapshot();
		expect(f.data[0]).toBe(0xff);
		expect(sends()).toBe(1);
	});

	it('throttle: a stall inside the window does not send again, one after it does', async () => {
		const { cam, hub, src, send, sends, setReady } = await rig({ enableThrottleMs: 700 });
		const s = hub.session('p1', async () => src, send);
		const stop = s.watch(() => {});
		await until(() => s.latest);
		expect(sends()).toBe(1);
		// Printer times the camera out: the stream goes silent, the stall fires within the window.
		setReady(false);
		const seq = s.latest!.seq;
		await new Promise((r) => setTimeout(r, 450));
		expect(sends()).toBe(1); // throttled
		// Past the window the next stall/not-ready cycle sends again and frames resume.
		await until(() => sends() === 2, 8000);
		await until(() => s.latest && s.latest.seq > seq + 1, 8000);
		expect(s.status).toBe('live');
		expect(cam.total).toBeGreaterThanOrEqual(3);
		stop();
	});

	it('a stalled open stream triggers one enable and a reconnect', async () => {
		const { hub, src, send, sends, setReady } = await rig({ enableThrottleMs: 0 });
		const s = hub.session('p1', async () => src, send);
		const stop = s.watch(() => {});
		await until(() => s.latest);
		const before = s.connects;
		setReady(false);
		await until(() => sends() >= 2, 8000);
		await until(() => s.connects > before && s.status === 'live', 8000);
		expect(sends()).toBe(2);
		stop();
	});

	it('without an enabler (Moonraker/OctoPrint) nothing is sent and the error stays an error', async () => {
		const { hub, src } = await rig();
		const s = hub.session('p1', async () => src);
		await expect(s.snapshot()).rejects.toBeInstanceOf(CameraError);
	});

	it('gives up after enableWaitMs when the camera never comes ready', async () => {
		const { hub, src, sends } = await rig({ enableWaitMs: 200 });
		const never = async () => (void sends(), true);
		const s = hub.session('p1', async () => src, never);
		await expect(s.snapshot()).rejects.toBeInstanceOf(CameraError);
	});

	it('settings Test: grabFrame enables first and waits for the camera', async () => {
		const { hub, src, send, sends } = await rig();
		const enable = hub.throttledEnabler('test:x', send);
		const jpg = await grabFrame(src, { enableRetryMs: 40, enableWaitMs: 2000 }, enable);
		expect(jpg[0]).toBe(0xff);
		expect(sends()).toBe(1);
		// Throttled: a second Test within 30 s does not send again.
		await grabFrame(src, { enableRetryMs: 40 }, enable);
		expect(sends()).toBe(1);
	});
});
