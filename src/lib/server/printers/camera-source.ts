/**
 * Where a printer's camera is: the team's override, the printer type's default, or what the
 * printer itself reports (Moonraker webcam list, OctoPrint settings). Every URL that comes out
 * has passed the SSRF guard: http(s) only, same host as the printer (and the connection itself
 * only ever goes to a validated local address, see `outbound.ts`).
 */
import {
	cameraSupported,
	checkCameraUrl,
	defaultCameraUrl,
	resolveCameraUrl
} from '#lib/printers/camera-url.ts';
import type { PrinterKind } from '#lib/printers/status.ts';
import type { printers } from '../db/schema';
import { assertOutboundAllowed, guardedFetch, isRedirect, readJsonCapped } from './outbound';
import { decryptSecrets } from './secrets';

export type CameraOrigin = 'custom' | 'default' | 'moonraker' | 'octoprint';

export interface CameraSource {
	/** Candidates in order of preference (stream before snapshot); the first that works is used. */
	urls: string[];
	origin: CameraOrigin;
	/** The printer's host: redirects and every request are held to it. */
	host: string;
}

export interface CameraTarget {
	kind: PrinterKind;
	host: string;
	port: number | null;
	cameraUrl: string | null;
	cameraEnabled: boolean;
	secrets: Record<string, string>;
}

export function toCameraTarget(r: typeof printers.$inferSelect): CameraTarget {
	return {
		kind: r.kind as PrinterKind,
		host: r.host,
		port: r.port,
		cameraUrl: r.cameraUrl,
		cameraEnabled: r.cameraEnabled,
		secrets: decryptSecrets(r.secretEnc)
	};
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

const hostPart = (h: string) => (h.includes(':') && !h.startsWith('[') ? `[${h}]` : h);

/** GET JSON from the printer's own API; never follows redirects, short timeout. */
async function getJson(
	url: string,
	headers: Record<string, string>,
	fetchFn: typeof fetch,
	timeoutMs: number
): Promise<unknown> {
	const res = await fetchFn(url, {
		headers,
		redirect: 'manual',
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (isRedirect(res.status)) throw new Error('redirect');
	if (!res.ok) throw new Error(`status ${res.status}`);
	return readJsonCapped(res);
}

export interface ResolveOptions {
	fetchFn?: typeof fetch;
	apiTimeoutMs?: number;
}

/** The camera for a printer, or null when it has none (off, unsupported, nothing reported). */
export async function resolveCameraSource(
	t: CameraTarget,
	opts: ResolveOptions = {}
): Promise<CameraSource | null> {
	if (!t.cameraEnabled || !cameraSupported(t.kind)) return null;
	assertOutboundAllowed(); // public mode: refused before any lookup or request
	const host = t.host;
	if (t.cameraUrl) {
		const c = checkCameraUrl(t.cameraUrl, host);
		return c.ok ? { urls: [c.url.toString()], origin: 'custom', host } : null;
	}
	const fetchFn = opts.fetchFn ?? guardedFetch;
	const timeout = opts.apiTimeoutMs ?? 5000;
	const h = hostPart(host);
	if (t.kind === 'elegoo-sdcp') {
		const d = defaultCameraUrl(t.kind, host);
		return d ? { urls: [d], origin: 'default', host } : null;
	}
	if (t.kind === 'moonraker') {
		const headers: Record<string, string> = {};
		if (t.secrets.apiKey) headers['X-Api-Key'] = t.secrets.apiKey;
		try {
			const j = await getJson(
				`http://${h}:${t.port ?? 7125}/server/webcams/list`,
				headers,
				fetchFn,
				timeout
			);
			const cams =
				isObj(j) && isObj(j.result) && Array.isArray(j.result.webcams) ? j.result.webcams : [];
			for (const cam of cams) {
				if (!isObj(cam) || cam.enabled === false) continue;
				const urls = [str(cam.stream_url), str(cam.snapshot_url)]
					.map((u) => (u ? resolveCameraUrl(u, `http://${h}/`, host) : null))
					.filter((u): u is URL => !!u)
					.map((u) => u.toString());
				if (urls.length) return { urls, origin: 'moonraker', host };
			}
		} catch {
			/* no webcam list: no camera */
		}
		return null;
	}
	if (t.kind === 'octoprint') {
		if (!t.secrets.apiKey) return null;
		try {
			const j = await getJson(
				`http://${h}:${t.port ?? 80}/api/settings`,
				{ 'X-Api-Key': t.secrets.apiKey },
				fetchFn,
				timeout
			);
			const w = isObj(j) && isObj(j.webcam) ? j.webcam : null;
			if (w && w.webcamEnabled !== false) {
				const urls = [str(w.streamUrl), str(w.snapshotUrl)]
					.map((u) => (u ? resolveCameraUrl(u, `http://${h}/`, host) : null))
					.filter((u): u is URL => !!u)
					.map((u) => u.toString());
				if (urls.length) return { urls, origin: 'octoprint', host };
			}
		} catch {
			/* key lacks settings permission, or old OctoPrint: no camera */
		}
		return null;
	}
	return null;
}
