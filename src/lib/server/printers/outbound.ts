/**
 * The outbound-connection guard. EVERYTHING the server connects to on a user's say-so (printer
 * adapters, cameras, discovery, connection tests, Spoolman) goes through here.
 *
 *  - Public mode (`TMT_MODE=public`): refused before any network activity (no DNS either), except
 *    an OctoEverywhere shared-link host on a call that passes `allowShareLink`.
 *  - Self-hosted: the host is resolved once (all A/AAAA records), EVERY answer must be on the
 *    owner's own network (`classifyAddress`), and the connection goes to the validated IP
 *    literal, so a second DNS answer cannot differ (DNS rebinding).
 *  - HTTP never follows redirects: `guardedFetch` hands every 3xx back and callers treat it as
 *    a failure. API keys are therefore only ever sent to the validated host.
 *
 *  - The ONE public destination, opt-in per call (`allowShareLink`, default false; only the
 *    shared-link paths of Elegoo, Klipper and OctoPrint pass it): an OctoEverywhere shared-link host (`isShareLinkHost`). Its
 *    name is resolved like any other, but EVERY answer must be a global unicast address (the
 *    inverse of the private-range rule: a link name that points inward is refused), and it is
 *    reached over https on the default port only.
 *
 * Do not use `fetch`, `net`, `dgram` or a WebSocket on a user-supplied host anywhere else.
 */
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import {
	classifyAddress,
	cleanHost,
	isIpLiteral,
	parseIPv4,
	parseIPv6,
	refusedMessage
} from '#lib/printers/address.ts';
import { isShareLinkHost } from '#lib/printers/share-link.ts';
import { ApiError } from '../access';
import { isPublicMode } from '../config';
import { maskSecrets } from './types';

export const PUBLIC_MODE_MESSAGE = 'Printer connections are not available on this hosted site yet.';

/** A refused or failed outbound target. An `ApiError`, so routes answer 4xx with the message. */
export class OutboundError extends ApiError {
	constructor(
		message: string,
		status = 400,
		public kind: 'public' | 'address' | 'dns' | 'redirect' | 'protocol' = 'address'
	) {
		super(status, maskSecrets(message)); // defence in depth: a share-link host never leaves in a message
	}
}

/**
 * Throws the public-mode refusal. Call before any network activity or DNS lookup. Only a caller
 * that is about to use an OctoEverywhere shared link passes `allowShareLink`; `resolveAllowed`
 * then still refuses every host that is not a share-link host.
 */
export function assertOutboundAllowed(opts: { allowShareLink?: boolean } = {}): void {
	if (isPublicMode() && !opts.allowShareLink)
		throw new OutboundError(PUBLIC_MODE_MESSAGE, 403, 'public');
}

/** Resolves a host name to every address it has (A and AAAA). Replaceable for tests. */
export type Resolver = (host: string) => Promise<string[]>;

const RESOLVE_TIMEOUT_MS = 5000;

/** Lookups still running in libuv's small thread pool, by host name. Our timeout cannot cancel one. */
const inFlight = new Map<string, Promise<string[]>>();
/** At most this many different names resolve at once, so slow DNS cannot starve the pool. */
export const MAX_INFLIGHT_LOOKUPS = 8;

const systemResolver: Resolver = async (host) => {
	// getaddrinfo also understands decimal/hex/octal spellings; we judge what it returns.
	let p = inFlight.get(host);
	if (!p) {
		if (inFlight.size >= MAX_INFLIGHT_LOOKUPS) throw new Error('too many lookups');
		// Concurrent callers for one name share this lookup; it stays registered until it really ends.
		p = lookup(host, { all: true, verbatim: true }).then((all) => all.map((a) => a.address));
		const mine = p;
		const forget = () => {
			if (inFlight.get(host) === mine) inFlight.delete(host);
		};
		mine.then(forget, forget);
		inFlight.set(host, p);
	}
	return Promise.race([
		p,
		new Promise<never>((_, rej) =>
			setTimeout(() => rej(new Error('dns timeout')), RESOLVE_TIMEOUT_MS).unref()
		)
	]);
};

let resolver: Resolver = systemResolver;
/** Tests only: swap the DNS resolver (null restores the system one). */
export function setResolver(r: Resolver | null) {
	resolver = r ?? systemResolver;
}

export interface ResolvedTarget {
	/** The host as the user gave it (cleaned). */
	host: string;
	/** The validated address to connect to. */
	ip: string;
	family: 4 | 6;
	/** True when `host` was already an IP literal (nothing to pin, no Host/SNI name). */
	literal: boolean;
	/** True for an OctoEverywhere shared-link host (a public address, https on 443 only). */
	shareLink?: boolean;
}

/**
 * True for an address on the public internet: global unicast only. Private, loopback,
 * link-local (169.254/16 incl. metadata), CGNAT, ULA, multicast, documentation, benchmarking,
 * 6to4/Teredo/NAT64 and IPv4-mapped private addresses are all false.
 */
export function isGlobalUnicast(raw: string): boolean {
	const ip = cleanHost(raw);
	const v = classifyAddress(ip);
	if (v.ok || v.reason !== 'public') return false; // private, metadata or reserved
	const v4 = parseIPv4(ip);
	if (v4) {
		const [a, b, c] = v4;
		if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // 192.0.0/24, 192.0.2/24
		if (a === 192 && b === 88 && c === 99) return false;
		if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
		if (a === 198 && b === 51 && c === 100) return false;
		if (a === 203 && b === 0 && c === 113) return false;
		return true;
	}
	const v6 = parseIPv6(ip);
	if (!v6) return false;
	const mapped = v6.slice(0, 10).every((x) => x === 0) && v6[10] === 0xff && v6[11] === 0xff;
	if (mapped) return isGlobalUnicast(v6.slice(12).join('.'));
	if ((v6[0] & 0xe0) !== 0x20) return false; // only 2000::/3 is global unicast
	if (v6[0] === 0x20 && v6[1] === 0x02) return false; // 2002::/16 6to4
	if (v6[0] === 0x20 && v6[1] === 0x01 && (v6[2] === 0 || (v6[2] === 0x0d && v6[3] === 0xb8)))
		return false; // 2001::/32 Teredo, 2001:db8::/32 documentation
	return true;
}

/** `[::1]` for IPv6, plain for IPv4: the form an address takes inside a URL. */
export const ipForUrl = (ip: string) => (ip.includes(':') ? `[${ip}]` : ip);

/**
 * Check a host and pick the address to connect to. Public mode: refused before any lookup.
 * Every resolved address must be allowed; one bad answer refuses the host.
 */
export async function resolveAllowed(
	rawHost: string,
	r: Resolver = resolver,
	opts: { allowShareLink?: boolean } = {}
): Promise<ResolvedTarget> {
	assertOutboundAllowed({ allowShareLink: opts.allowShareLink });
	const host = cleanHost(rawHost);
	if (!host) throw new OutboundError('Enter the printer address.');
	// Hosted site: the shared-link host is the only destination, whatever else the caller passes.
	if (isPublicMode() && !isShareLinkHost(host))
		throw new OutboundError(PUBLIC_MODE_MESSAGE, 403, 'public');
	if (isIpLiteral(host)) {
		const v = classifyAddress(host);
		if (!v.ok) throw new OutboundError(refusedMessage(v, rawHost));
		return { host, ip: v.ip, family: v.family === 6 || host.includes(':') ? 6 : 4, literal: true };
	}
	// A share-link host IS the secret: no message below may contain it, whatever the caller allows.
	const secretHost = isShareLinkHost(host);
	const notFound = () =>
		new OutboundError(
			secretHost
				? 'The OctoEverywhere link could not be found. Check the link.'
				: `Could not find ${host}. Check the address.`,
			400,
			'dns'
		);
	let answers: string[];
	try {
		answers = await r(host);
	} catch {
		throw notFound();
	}
	if (!answers.length) throw notFound();
	if (secretHost && opts.allowShareLink) {
		// The one public destination: every answer must be global unicast, then pin one.
		if (!answers.every((a) => isGlobalUnicast(a)))
			throw new OutboundError(
				'The OctoEverywhere link does not point to a public address, so it was refused.',
				400,
				'address'
			);
		const pick = answers.find((a) => !a.includes(':')) ?? answers[0];
		return {
			host,
			ip: cleanHost(pick),
			family: pick.includes(':') ? 6 : 4,
			literal: false,
			shareLink: true
		};
	}
	const verdicts = answers.map((a) => classifyAddress(a));
	for (const v of verdicts)
		if (!v.ok)
			throw new OutboundError(
				secretHost
					? 'The OctoEverywhere link is not allowed here: it is not on your local network.'
					: refusedMessage(v, host)
			);
	const ok = verdicts.filter((v) => v.ok);
	const pick = ok.find((v) => !v.ip.includes(':')) ?? ok[0];
	return { host, ip: pick.ip, family: pick.ip.includes(':') ? 6 : 4, literal: false };
}

/**
 * Why a saved host can never be used, without any network activity: public mode, or an IP
 * literal that is not on a private range. Null for host names (those are judged at connect).
 */
export function hostBlockReason(rawHost: string): string | null {
	if (isPublicMode()) return PUBLIC_MODE_MESSAGE;
	const host = cleanHost(rawHost);
	if (!isIpLiteral(host)) return null;
	const v = classifyAddress(host);
	return v.ok ? null : refusedMessage(v, rawHost);
}

/** Remote-supplied text, made safe to show: control characters out, one line, length-capped. */
export function safeText(v: unknown, max = 120): string {
	if (typeof v !== 'string') return '';
	let out = '';
	for (const ch of v) {
		const c = ch.codePointAt(0)!;
		out += c < 32 || c === 127 || (c >= 0x80 && c < 0xa0) ? ' ' : ch;
	}
	return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Longest printer-reported file name kept (real slicer names are well under this). */
export const MAX_FILE_NAME = 200;

/** A printer-reported file name, made safe to store and broadcast; undefined when empty. */
export function safeFileName(v: unknown): string | undefined {
	return safeText(v, MAX_FILE_NAME) || undefined;
}

/**
 * Largest WebSocket / MQTT message we parse. Real printers send a few KB (Bambu full reports
 * up to ~100 KB); anything larger is dropped unparsed.
 */
export const MAX_REMOTE_MESSAGE_BYTES = 1024 * 1024;

const BAD_STATUS_MESSAGE = 'The device sent an invalid answer.';

const NULL_BODY = new Set([101, 204, 205, 304]);

type FetchInit = Parameters<typeof fetch>[1] & {
	/** OctoEverywhere link paths only (Elegoo, Klipper, OctoPrint): lets a share-link host through (public, https:443). */
	allowShareLink?: boolean;
};

/**
 * `fetch` for user-supplied hosts. Resolves and validates the host, connects to the validated IP
 * (the URL's host name still goes into Host and TLS SNI), and never follows a redirect: a 3xx
 * comes back as an ordinary response for the caller to treat as a failure.
 */
export async function guardedFetch(
	input: string | URL | Request,
	init: FetchInit = {}
): Promise<Response> {
	const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
	assertOutboundAllowed({ allowShareLink: init?.allowShareLink === true });
	if (url.protocol !== 'http:' && url.protocol !== 'https:')
		throw new OutboundError('The address must start with http:// or https://', 400, 'protocol');
	const allowShareLink = init?.allowShareLink === true;
	if (
		allowShareLink &&
		isShareLinkHost(cleanHost(url.hostname)) &&
		(url.protocol !== 'https:' || url.port)
	)
		throw new OutboundError(
			'The OctoEverywhere link is reached over https on the default port only.',
			400,
			'protocol'
		);
	const target = await resolveAllowed(url.hostname, undefined, { allowShareLink });
	const headers = new Headers(init?.headers);
	if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'identity');
	const body = init?.body;
	if (body !== undefined && body !== null && typeof body !== 'string')
		throw new OutboundError('Unsupported request body', 400, 'protocol');
	const isHttps = url.protocol === 'https:';
	const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
	const signal = init?.signal ?? undefined;

	return new Promise<Response>((resolve, reject) => {
		const req = (isHttps ? https : http).request(
			{
				hostname,
				port: url.port || (isHttps ? 443 : 80),
				path: `${url.pathname}${url.search}`,
				method: init?.method ?? 'GET',
				headers: Object.fromEntries(headers),
				agent: false,
				signal,
				// The pin: whatever name is asked for, connect to the address we validated.
				lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
					if (opts?.all) cb(null, [{ address: target.ip, family: target.family }]);
					else cb(null, target.ip, target.family);
				}) as never,
				...(isHttps && !target.literal ? { servername: hostname } : {})
			},
			(res) => {
				// Runs outside the promise chain: anything thrown here would be an uncaught exception.
				res.on('error', () => {});
				try {
					const status = res.statusCode ?? 0;
					if (!Number.isInteger(status) || status < 200 || status > 599) {
						res.destroy();
						throw new OutboundError(BAD_STATUS_MESSAGE, 502, 'protocol');
					}
					const h = new Headers();
					for (const [k, v] of Object.entries(res.headers)) {
						if (Array.isArray(v)) for (const x of v) h.append(k, x);
						else if (v !== undefined) h.set(k, v);
					}
					if (NULL_BODY.has(status)) {
						res.resume();
						return resolve(new Response(null, { status, headers: h }));
					}
					if (status >= 300 && status < 400) {
						// Never followed and never read: drop the connection now instead of leaving the
						// body (and its socket) for a caller that only looks at the status.
						res.destroy();
						return resolve(new Response(null, { status, headers: h }));
					}
					resolve(
						new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers: h })
					);
				} catch (e) {
					req.destroy();
					reject(e);
				}
			}
		);
		req.on('error', reject);
		if (typeof body === 'string') req.write(body);
		req.end();
	});
}

/** JSON body of a small API answer, at most `max` bytes. Throws when it is larger or not JSON. */
export async function readJsonCapped(res: Response, max = 1024 * 1024): Promise<unknown> {
	const reader = res.body?.getReader();
	if (!reader) throw new Error('empty');
	const parts: Uint8Array[] = [];
	let n = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		n += value.length;
		if (n > max) {
			await reader.cancel().catch(() => {});
			throw new Error('too large');
		}
		parts.push(value);
	}
	return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

/** Message for a 3xx answer from a user-supplied host (redirects are never followed). */
export const REDIRECT_MESSAGE =
	'The device redirected the request, which is not allowed. Use its direct address (no redirect).';

export const isRedirect = (status: number) => status >= 300 && status < 400;
