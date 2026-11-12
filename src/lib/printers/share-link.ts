/**
 * OctoEverywhere shared-connection links (Elegoo, Klipper/Moonraker, OctoPrint). Browser-safe,
 * no Node imports.
 *
 * The link (`https://shared-<token>.octoeverywhere.com`) is a secret: anyone holding it can
 * reach the printer through OctoEverywhere. It is stored encrypted next to the other printer
 * secrets (key `shareLink`) and never returned to the browser. The shape is pinned on purpose:
 * only that one host family is accepted, so the camera SSRF guard can be pinned to the link's
 * host without opening it up to anything else.
 */

/** Secret-field key for the shared link inside the encrypted printer secrets. */
export const SHARE_LINK_KEY = 'shareLink';

/** Printer kinds that can be reached through a shared link (Bambu LAN is MQTT/TLS, which a web link cannot carry). */
export const SHARE_LINK_KINDS = ['elegoo-sdcp', 'moonraker', 'octoprint'] as const;
export const supportsShareLink = (kind: string): boolean =>
	(SHARE_LINK_KINDS as readonly string[]).includes(kind);

/** Stored in `printers.host` (not secret, shown in the UI) when the printer is reached by link. */
export const SHARE_LINK_HOST_PLACEHOLDER = 'octoeverywhere';

const HOST_RE = /^shared-[a-z0-9]{8,64}\.octoeverywhere\.com$/;

/** True for a share-link host (`shared-<token>.octoeverywhere.com`). */
export const isShareLinkHost = (host: string) => HOST_RE.test(host.trim().toLowerCase());

/**
 * Anything on octoeverywhere.com (a pasted share link, with or without scheme and path). Such a
 * value belongs in the shared-link field, never in the address: the address is shown to every
 * member and dialled directly.
 */
export function isOctoEverywhereAddress(raw: string): boolean {
	const t = raw.trim();
	let h = t;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
		try {
			h = new URL(t).hostname;
		} catch {
			return /octoeverywhere\.com/i.test(t);
		}
	}
	h = h
		.toLowerCase()
		.replace(/[/?#:].*$/, '')
		.replace(/\.$/, '');
	return h === 'octoeverywhere.com' || h.endsWith('.octoeverywhere.com');
}

export type ShareLinkCheck =
	{ ok: true; origin: string; host: string } | { ok: false; error: string };

/** Validate a shared link; `origin` is the normalised `https://<host>` (no path, port or query). */
export function parseShareLink(raw: string): ShareLinkCheck {
	const bad = {
		ok: false,
		error: 'Paste the OctoEverywhere shared link, like https://shared-…octoeverywhere.com'
	} as const;
	let u: URL;
	try {
		u = new URL(raw.trim());
	} catch {
		return bad;
	}
	if (u.protocol !== 'https:') return bad;
	if (u.username || u.password || u.port || u.search || u.hash) return bad;
	if (u.pathname !== '/' && u.pathname !== '') return bad;
	const host = u.hostname.toLowerCase();
	if (!HOST_RE.test(host)) return bad;
	return { ok: true, origin: `https://${host}`, host };
}

/** The link's pieces from decrypted secrets, or null when none is set (or it is not valid). */
export function shareLinkOf(
	secrets: Record<string, string> | undefined
): { origin: string; host: string } | null {
	const raw = secrets?.[SHARE_LINK_KEY];
	if (!raw) return null;
	const c = parseShareLink(raw);
	return c.ok ? { origin: c.origin, host: c.host } : null;
}

/** SDCP websocket URL through the link (the path the printer itself serves on :3030). */
export const shareLinkSocketUrl = (origin: string) => `wss://${new URL(origin).host}/websocket`;

/** Camera URL through the link: OctoEverywhere serves the printer's MJPEG stream at `/video`. */
export const shareLinkCameraUrl = (origin: string) => `${origin}/video`;

/** The link of a printer of `kind`: null for kinds that cannot use one, or when none is set. */
export function shareLinkFor(
	kind: string,
	secrets: Record<string, string> | undefined
): { origin: string; host: string } | null {
	return supportsShareLink(kind) ? shareLinkOf(secrets) : null;
}

/** An https URL on the link host for an API path (Moonraker and OctoPrint requests through the link). */
export const shareLinkUrl = (origin: string, path: string) =>
	`${origin}${path.startsWith('/') ? path : `/${path}`}`;
