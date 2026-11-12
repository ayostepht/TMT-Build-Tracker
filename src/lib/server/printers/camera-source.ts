import { isObj } from '#lib/domain/guards.ts';
/**
 * Where a printer's camera is: the team's override, the printer type's default, or what the
 * printer itself reports (Moonraker webcam list, OctoPrint settings). Every URL that comes out
 * has passed the SSRF guard: http(s) only, same host as the printer (and the connection itself
 * only ever goes to a validated local address, or the shared link's validated public one, see
 * `outbound.ts`).
 */
import {
	cameraSupported,
	checkCameraUrl,
	defaultCameraUrl,
	resolveCameraUrl
} from '#lib/printers/camera-url.ts';
import {
	SHARE_LINK_HOST_PLACEHOLDER,
	shareLinkCameraUrl,
	shareLinkFor,
	shareLinkUrl
} from '#lib/printers/share-link.ts';
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
	/** Built from an OctoEverywhere link: the only source allowed to reach a share host. */
	shareLink?: boolean;
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

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Most camera URLs / webcam entries kept from what a remote Moonraker or OctoPrint reports. */
export const MAX_CAMERA_URLS = 4;
/** Longest remote camera URL kept (the same cap as a saved custom address). */
const MAX_CAMERA_URL_LENGTH = 500;

const hostPart = (h: string) => (h.includes(':') && !h.startsWith('[') ? `[${h}]` : h);

/** GET JSON from the printer's own API; never follows redirects, short timeout. */
async function getJson(
	url: string,
	headers: Record<string, string>,
	fetchFn: typeof fetch,
	timeoutMs: number,
	shareLink = false
): Promise<unknown> {
	const res = await fetchFn(url, {
		headers,
		redirect: 'manual',
		signal: AbortSignal.timeout(timeoutMs),
		...(shareLink ? { allowShareLink: true } : {})
	} as RequestInit);
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
	const link = shareLinkFor(t.kind, t.secrets);
	assertOutboundAllowed({ allowShareLink: !!link }); // public mode: only a link printer goes on
	const fetchFn = opts.fetchFn ?? guardedFetch;
	const timeout = opts.apiTimeoutMs ?? 5000;
	// Through an OctoEverywhere shared link every request and redirect is pinned to the link's
	// host (a custom address is ignored): Elegoo's stream is the link's /video; Moonraker's and
	// OctoPrint's come from the printer's own API, and only same-host (relative) URLs survive.
	if (link) {
		if (t.kind === 'elegoo-sdcp') {
			const c = checkCameraUrl(shareLinkCameraUrl(link.origin), link.host);
			return c.ok
				? { urls: [c.url.toString()], origin: 'default', host: link.host, shareLink: true }
				: null;
		}
		const listed = await listedCameras(t, link.origin, link.host, fetchFn, timeout, true);
		return listed ? { ...listed, shareLink: true } : null;
	}
	const host = t.host;
	if (host === SHARE_LINK_HOST_PLACEHOLDER) return null; // link missing: never dial the placeholder
	if (t.cameraUrl) {
		const c = checkCameraUrl(t.cameraUrl, host);
		return c.ok ? { urls: [c.url.toString()], origin: 'custom', host } : null;
	}
	if (t.kind === 'elegoo-sdcp') {
		const d = defaultCameraUrl(t.kind, host);
		return d ? { urls: [d], origin: 'default', host } : null;
	}
	return listedCameras(
		t,
		`http://${hostPart(host)}:${t.port ?? (t.kind === 'moonraker' ? 7125 : 80)}`,
		host,
		fetchFn,
		timeout,
		false
	);
}

/** Moonraker's webcam list / OctoPrint's webcam settings, asked of the printer's API at `api`. */
async function listedCameras(
	t: CameraTarget,
	api: string,
	host: string,
	fetchFn: typeof fetch,
	timeout: number,
	shareLink: boolean
): Promise<CameraSource | null> {
	const base = shareLink ? `${api}/` : `http://${hostPart(host)}/`;
	const pick = (...cands: unknown[]) =>
		cands
			.map((u) =>
				str(u) && str(u)!.length <= MAX_CAMERA_URL_LENGTH
					? resolveCameraUrl(str(u)!, base, host)
					: null
			)
			.filter((u): u is URL => !!u)
			.map((u) => u.toString())
			.slice(0, MAX_CAMERA_URLS);
	if (t.kind === 'moonraker') {
		const headers: Record<string, string> = {};
		if (t.secrets.apiKey) headers['X-Api-Key'] = t.secrets.apiKey;
		try {
			const j = await getJson(
				shareLinkUrl(api, '/server/webcams/list'),
				headers,
				fetchFn,
				timeout,
				shareLink
			);
			const cams =
				isObj(j) && isObj(j.result) && Array.isArray(j.result.webcams) ? j.result.webcams : [];
			for (const cam of cams.slice(0, MAX_CAMERA_URLS)) {
				if (!isObj(cam) || cam.enabled === false) continue;
				const urls = pick(cam.stream_url, cam.snapshot_url);
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
				shareLinkUrl(api, '/api/settings'),
				{ 'X-Api-Key': t.secrets.apiKey },
				fetchFn,
				timeout,
				shareLink
			);
			const w = isObj(j) && isObj(j.webcam) ? j.webcam : null;
			if (w && w.webcamEnabled !== false) {
				const urls = pick(w.streamUrl, w.snapshotUrl);
				if (urls.length) return { urls, origin: 'octoprint', host };
			}
		} catch {
			/* key lacks settings permission, or old OctoPrint: no camera */
		}
		return null;
	}
	return null;
}
