/** Printer camera URL rules shared by server and browser. No Node imports. */
import { cleanHost } from './address.ts';
import { isShareLinkHost } from './share-link.ts';
import type { PrinterKind } from './status.ts';

/**
 * Bambu's LAN camera is a proprietary stream (RTSPS / port 6000 JPEG protocol): not supported.
 * A manual (not connected) printer has no address to fetch from.
 */
export function cameraSupported(kind: PrinterKind): boolean {
	return kind !== 'bambu-lan' && kind !== 'manual';
}

/**
 * The camera URL a printer uses when none is set. Only Elegoo SDCP has a fixed one; Moonraker and
 * OctoPrint are asked for theirs at run time (see server `camera-source.ts`).
 */
export function defaultCameraUrl(kind: PrinterKind, host: string): string | null {
	if (kind !== 'elegoo-sdcp') return null;
	const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
	return `http://${h}:3031/video`;
}

export type CameraUrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/**
 * SSRF guard: only http(s) URLs without credentials whose host equals the printer's configured
 * host (any port). Everything else is refused.
 */
export function checkCameraUrl(raw: string, printerHost: string): CameraUrlCheck {
	let u: URL;
	try {
		u = new URL(raw.trim());
	} catch {
		return { ok: false, error: 'Enter a full camera address like http://192.168.0.50:8080/stream' };
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:')
		return { ok: false, error: 'The camera address must start with http:// or https://' };
	if (u.username || u.password)
		return { ok: false, error: 'Leave user name and password out of the camera address' };
	if (cleanHost(u.hostname) !== cleanHost(printerHost))
		return { ok: false, error: 'The camera must be on the same address as the printer' };
	// An OctoEverywhere share-link host is reached over https on the default port only.
	if (isShareLinkHost(cleanHost(printerHost)) && (u.protocol !== 'https:' || u.port))
		return { ok: false, error: 'The camera must use https on the default port' };
	return { ok: true, url: u };
}

/** Resolve a (possibly relative) URL from a printer's own API against its host, then guard it. */
export function resolveCameraUrl(raw: string, base: string, printerHost: string): URL | null {
	try {
		const r = checkCameraUrl(new URL(raw, base).toString(), printerHost);
		return r.ok ? r.url : null;
	} catch {
		return null;
	}
}
