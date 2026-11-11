/**
 * Security headers for every response, added in `hooks.server.ts`.
 *
 * The page Content-Security-Policy (script nonces, `'self'` sources) is SvelteKit's own `kit.csp`
 * in `vite.config.ts`: it nonces the inline bootstrap script, which a header written here could
 * not. What kit does not cover is added here: the same frame/object lockdown for everything that is
 * not a page (JSON, images, GLBs, downloads, redirects) and, for `/api/`, `sandbox`, so a stored
 * upload can never render as an active document even if a handler forgot its content type.
 */

/** Browser features the app never uses. Clipboard (copy link) and fullscreen stay allowed. */
export const PERMISSIONS_POLICY = [
	'camera',
	'microphone',
	'geolocation',
	'payment',
	'usb',
	'serial',
	'bluetooth',
	'hid',
	'midi',
	'display-capture'
]
	.map((f) => `${f}=()`)
	.join(', ');

/** Six months; no `includeSubDomains` or `preload`: the parent domain of a self-hoster is not ours to pin. */
export const HSTS = 'max-age=15552000';

/** For responses that are not pages: nothing may load from, or embed, them. */
export const LOCKDOWN_CSP = "default-src 'none'; frame-ancestors 'none'";
/** `/api/` bytes (uploads, GLBs, JSON): also sandboxed, so nothing in them can ever run. */
export const API_CSP = `${LOCKDOWN_CSP}; sandbox`;
/** Fallback for an HTML response that has no kit CSP (should not happen). */
const HTML_FALLBACK_CSP = "frame-ancestors 'none'";

/** Paths whose URL carries a bearer id or token: never sent as a Referer, even same-origin. */
const PRIVATE_URL_PATHS = /^\/(invite|reset-password)(\/|$)/;

export interface HeaderContext {
	pathname: string;
	/** The request's effective scheme is https (PUBLIC_URL or the proxy-normalised protocol). */
	https: boolean;
	/** The response's content-type header, if any. */
	contentType: string | null;
	/** The response already carries a Content-Security-Policy (SvelteKit's page CSP). */
	hasCsp: boolean;
}

/** Header name to value; set all of them on the response (they replace anything a handler set). */
export function securityHeaders(ctx: HeaderContext): Record<string, string> {
	const isHtml = /^text\/html\b/i.test(ctx.contentType ?? '');
	const out: Record<string, string> = {
		'x-content-type-options': 'nosniff',
		'referrer-policy': PRIVATE_URL_PATHS.test(ctx.pathname)
			? 'no-referrer'
			: 'strict-origin-when-cross-origin',
		'x-frame-options': 'DENY',
		'permissions-policy': PERMISSIONS_POLICY
	};
	if (ctx.https) out['strict-transport-security'] = HSTS;
	// Documents only: OAuth sign-in is a same-tab redirect, there are no popups or window.opener uses.
	if (isHtml) out['cross-origin-opener-policy'] = 'same-origin';
	if (ctx.pathname.startsWith('/api/')) out['content-security-policy'] = API_CSP;
	else if (!ctx.hasCsp) out['content-security-policy'] = isHtml ? HTML_FALLBACK_CSP : LOCKDOWN_CSP;
	return out;
}

/** The response with the headers set. Redirects and fetch responses have immutable headers: copied then. */
export function withHeaders(res: Response, headers: Record<string, string>): Response {
	try {
		for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
		return res;
	} catch {
		const copy = new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers: new Headers(res.headers)
		});
		for (const [k, v] of Object.entries(headers)) copy.headers.set(k, v);
		return copy;
	}
}
