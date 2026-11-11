import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { openUpstream } from './camera';
import { resolveCameraSource, type CameraTarget } from './camera-source';
import { guardedFetch } from './outbound';

/**
 * The printer's API key/token is only ever sent to the printer's own API URL. A camera URL (custom,
 * or reported by the printer) is fetched by `openUpstream`, which has no credentials to send, so a
 * camera URL naming another port or path on the same host never receives the key.
 */
const servers: Server[] = [];
afterEach(async () => {
	while (servers.length) await new Promise<void>((r) => servers.pop()!.close(() => r()));
});
async function listen(fn: (req: IncomingMessage) => string) {
	const hits: Record<string, string | string[] | undefined>[] = [];
	const srv = createServer((req, res) => {
		hits.push({ ...req.headers, url: req.url });
		res.writeHead(200, { 'content-type': 'application/json' }).end(fn(req));
	});
	servers.push(srv);
	await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
	return { port: (srv.address() as AddressInfo).port, hits };
}
const secretHeaders = (h: Record<string, unknown>) =>
	['x-api-key', 'authorization', 'cookie', 'x-auth-token'].filter((k) => k in h);
const target = (o: Partial<CameraTarget>): CameraTarget => ({
	kind: 'moonraker',
	host: '127.0.0.1',
	port: null,
	cameraUrl: null,
	cameraEnabled: true,
	secrets: { apiKey: 'SECRETKEY' },
	...o
});
const opts = { connectTimeoutMs: 2000, fetchFn: guardedFetch };

describe('camera fetches never carry the printer API key', () => {
	it('Moonraker: the key goes to the API port, the webcam on another port gets none', async () => {
		const cam = await listen(() => '{}');
		const api = await listen(() =>
			JSON.stringify({
				result: {
					webcams: [
						{ enabled: true, stream_url: `http://127.0.0.1:${cam.port}/webcam/?action=stream` }
					]
				}
			})
		);
		const src = await resolveCameraSource(target({ port: api.port }), { fetchFn: guardedFetch });
		expect(src?.urls).toEqual([`http://127.0.0.1:${cam.port}/webcam/?action=stream`]);
		expect(api.hits[0]['x-api-key']).toBe('SECRETKEY');
		await (
			await openUpstream(src!.urls[0], '127.0.0.1', new AbortController().signal, opts)
		).text();
		expect(cam.hits).toHaveLength(1);
		expect(secretHeaders(cam.hits[0])).toEqual([]);
	});

	it('a custom camera URL on a different port than the printer API gets no credentials', async () => {
		const other = await listen(() => '{}'); // some other service on the same host
		const src = await resolveCameraSource(
			target({ kind: 'octoprint', port: 5000, cameraUrl: `http://127.0.0.1:${other.port}/admin` })
		);
		expect(src).toMatchObject({ origin: 'custom' });
		const res = await openUpstream(src!.urls[0], '127.0.0.1', new AbortController().signal, opts);
		await res.text();
		expect(other.hits).toHaveLength(1);
		expect(secretHeaders(other.hits[0])).toEqual([]);
	});

	it('a custom camera URL on the printer API port itself still gets no credentials (cameras are fetched keyless)', async () => {
		const same = await listen(() => '{}');
		const src = await resolveCameraSource(
			target({
				kind: 'octoprint',
				port: same.port,
				cameraUrl: `http://127.0.0.1:${same.port}/webcam/?action=stream`
			})
		);
		await (
			await openUpstream(src!.urls[0], '127.0.0.1', new AbortController().signal, opts)
		).text();
		expect(secretHeaders(same.hits[0])).toEqual([]);
	});

	it('the OctoPrint settings request (the only keyed call) goes to the API port only', async () => {
		const cam = await listen(() => '{}');
		const api = await listen(() =>
			JSON.stringify({
				webcam: { webcamEnabled: true, streamUrl: `http://127.0.0.1:${cam.port}/s` }
			})
		);
		await resolveCameraSource(target({ kind: 'octoprint', port: api.port }), {
			fetchFn: guardedFetch
		});
		expect(api.hits[0]['x-api-key']).toBe('SECRETKEY');
		expect(cam.hits).toHaveLength(0); // resolving the source never touches the camera
	});
});
