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
	if (typeof address !== 'string' || !isIP(address.trim())) return null;
	const headers = new Headers(inbound);
	headers.delete('x-forwarded-for');
	headers.set('x-forwarded-for', address.trim());
	return headers;
}
