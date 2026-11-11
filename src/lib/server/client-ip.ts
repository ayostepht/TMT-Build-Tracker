import { isIP } from 'node:net';

/**
 * Headers for a request handed to Better Auth, whose rate limits key on `x-forwarded-for`.
 *
 * Any client-sent `x-forwarded-for` is discarded and replaced by one single-valued entry
 * taken from `getClientAddress()`. adapter-node has already applied `ADDRESS_HEADER` /
 * `XFF_DEPTH` there (socket address when no proxy is configured), so a client can neither
 * rotate the header to dodge the limits nor aim it at someone else's address. The original
 * chain is never forwarded: Better Auth returns no address for a multi-valued header unless
 * it is given its own `trustedProxies`.
 *
 * Returns null (fail closed) when no usable address exists: `getClientAddress()` throws
 * when the configured header is absent or the depth exceeds the chain, and a value that is
 * not an IP literal would make Better Auth skip rate limiting. Never fall back to the
 * client's own header.
 */
export function authRequestHeaders(
	inbound: Headers,
	getClientAddress: () => string
): Headers | null {
	let address: string;
	try {
		address = getClientAddress();
	} catch {
		return null;
	}
	if (typeof address !== 'string') return null;
	const clean = normaliseClientAddress(address);
	if (!clean) return null;
	const headers = new Headers(inbound);
	headers.delete('x-forwarded-for');
	headers.set('x-forwarded-for', clean);
	return headers;
}

/**
 * A client address in the form Better Auth's rate limiter accepts, or null (fail closed).
 * Its validator (`isValidIP` in `@better-auth/core/dist/utils/ip.mjs`, zod ipv4/ipv6) rejects
 * IPv6 zone ids such as `fe80::1%eth0` even though `net.isIP` accepts them, and an address it
 * rejects silently skips rate limiting, so any `%` is refused here. An IPv4-mapped IPv6
 * address (`::ffff:203.0.113.5`, how Node reports IPv4 peers on a dual-stack socket) is passed
 * on as plain IPv4, so one client has one bucket however the socket reported it.
 */
export function normaliseClientAddress(raw: string): string | null {
	const address = raw.trim();
	if (!address || address.includes('%') || !isIP(address)) return null;
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
	if (mapped && isIP(mapped[1]) === 4) return mapped[1];
	return address;
}

const PROXY_HINT_HEADERS = ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host'];

/**
 * Whether to log the "a reverse proxy appears to be in front" hint: the request carries a
 * forwarding header, no trusted proxy is configured, and the hint was not logged yet.
 * The caller records that it logged. Pure: the headers only decide, nothing is echoed.
 */
export function shouldWarnUndeclaredProxy(
	headers: Headers,
	proxyTrusted: boolean,
	alreadyWarned: boolean
): boolean {
	if (alreadyWarned || proxyTrusted) return false;
	return PROXY_HINT_HEADERS.some((h) => headers.has(h));
}

export const UNDECLARED_PROXY_WARNING =
	'[tmt] A reverse proxy appears to be in front of this server (forwarding headers are present) but ADDRESS_HEADER is not set, so all users currently share one sign-in rate limit (the proxy address) and a few people can lock each other out. If EVERY request reaches the app through that proxy, set ADDRESS_HEADER=x-forwarded-for (and XFF_DEPTH if more than one proxy is in front). Do not set it if the port is also reachable directly. This message is logged once.';
