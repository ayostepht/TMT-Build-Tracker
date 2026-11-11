// Default security headers for responses that never pass through `hooks.server.ts`: static files
// (adapter-node answers /_app/immutable/*, /fonts/* and the rest of build/client with sirv before
// SvelteKit runs) and error responses built outside `handle` (adapter-node's own 413, SvelteKit's
// 400/404/500 pages for a thrown error or a malformed URL).
//
// Installed by `proxy-origin.mjs` (preloaded with `node --import`). It wraps
// `ServerResponse.prototype.writeHead` and sets each header only when the response does not
// carry it already, so everything `hooks.server.ts` sets (the page CSP with its nonces) wins.
// Keep the values in step with `src/lib/server/security-headers.ts` (a unit test compares them).

export const HSTS = 'max-age=15552000';
const PERMISSIONS_POLICY = [
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
const LOCKDOWN_CSP = "default-src 'none'; frame-ancestors 'none'";
const API_CSP = `${LOCKDOWN_CSP}; sandbox`;
const HTML_FALLBACK_CSP = "frame-ancestors 'none'";
// PWA files that must be revalidated on every load: a browser re-checks the service worker script
// itself, but proxies and the HTTP cache must not pin a stale worker, manifest or offline page.
const REVALIDATE_PATHS = new Set(['/service-worker.js', '/manifest.webmanifest', '/offline.html']);
const PRIVATE_URL_PATHS = /^\/(invite|reset-password)(\/|$)/;

/**
 * Header name to value for a response. A CSP is only added to HTML, errors and `/api/`: a successful
 * static script or worker (a service worker takes its CSP from its own response) must not get
 * `default-src 'none'`.
 * @param {{ pathname: string, https: boolean, contentType: string | null | undefined, status: number }} ctx
 * @returns {Record<string, string>}
 */
export function responseDefaults({ pathname, https, contentType, status }) {
	const isHtml = /^text\/html\b/i.test(contentType ?? '');
	/** @type {Record<string, string>} */
	const out = {
		'x-content-type-options': 'nosniff',
		'referrer-policy': PRIVATE_URL_PATHS.test(pathname)
			? 'no-referrer'
			: 'strict-origin-when-cross-origin',
		'x-frame-options': 'DENY',
		'permissions-policy': PERMISSIONS_POLICY,
		'cross-origin-resource-policy': 'same-origin'
	};
	if (REVALIDATE_PATHS.has(pathname)) out['cache-control'] = 'no-cache';
	if (https) out['strict-transport-security'] = HSTS;
	if (isHtml) out['cross-origin-opener-policy'] = 'same-origin';
	if (pathname.startsWith('/api/')) out['content-security-policy'] = API_CSP;
	else if (isHtml) out['content-security-policy'] = HTML_FALLBACK_CSP;
	else if (status >= 400) out['content-security-policy'] = LOCKDOWN_CSP;
	return out;
}

/**
 * Wrap `writeHead` on the given `ServerResponse` prototype. Idempotent.
 * @param {any} proto
 */
export function installResponseDefaults(proto) {
	if (proto.__tmtDefaults) return;
	proto.__tmtDefaults = true;
	const writeHead = proto.writeHead;
	proto.writeHead = /** @this {any} @param {any} status @param {any[]} rest */ function (
		status,
		...rest
	) {
		try {
			if (!this.headersSent) {
				const url = this.req?.url ?? '/';
				let pathname = url.split('?')[0] || '/';
				if (!pathname.startsWith('/')) pathname = '/';
				const fwd = String(this.req?.headers?.['x-forwarded-proto'] ?? '');
				// Headers passed to writeHead itself win over setHeader ones, so look at them too.
				/** @type {Record<string, any>} */
				const given = rest.find((a) => a && typeof a === 'object' && !Array.isArray(a)) ?? {};
				const givenKeys = new Set(Object.keys(given).map((k) => k.toLowerCase()));
				const type =
					this.getHeader('content-type') ?? given['content-type'] ?? given['Content-Type'];
				const defaults = responseDefaults({
					pathname,
					https: fwd === 'https',
					contentType: Array.isArray(type) ? type[0] : (type ?? null),
					status: Number(status) || 0
				});
				for (const [k, v] of Object.entries(defaults)) {
					if (!this.hasHeader(k) && !givenKeys.has(k)) this.setHeader(k, v);
				}
			}
		} catch {
			// Never let header defaults break a response.
		}
		return writeHead.call(this, status, ...rest);
	};
}
