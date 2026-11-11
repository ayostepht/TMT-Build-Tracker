/**
 * The outbound-connection guard. EVERYTHING the server connects to on a user's say-so (printer
 * adapters, cameras, discovery, connection tests, Spoolman) goes through here.
 *
 *  - Public mode (`TMT_MODE=public`): refused before any network activity (no DNS either).
 *  - Self-hosted: the host is resolved once (all A/AAAA records), EVERY answer must be on the
 *    owner's own network (`classifyAddress`), and the connection goes to the validated IP
 *    literal, so a second DNS answer cannot differ (DNS rebinding).
 *  - HTTP never follows redirects: `guardedFetch` hands every 3xx back and callers treat it as
 *    a failure. API keys are therefore only ever sent to the validated host.
 *
 * Do not use `fetch`, `net`, `dgram` or a WebSocket on a user-supplied host anywhere else.
 */
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { classifyAddress, cleanHost, isIpLiteral, refusedMessage } from '#lib/printers/address.ts';
import { ApiError } from '../access';
import { isPublicMode } from '../config';

export const PUBLIC_MODE_MESSAGE = 'Printer connections are not available on this hosted site yet.';

/** A refused or failed outbound target. An `ApiError`, so routes answer 4xx with the message. */
export class OutboundError extends ApiError {
	constructor(
		message: string,
		status = 400,
		public kind: 'public' | 'address' | 'dns' | 'redirect' | 'protocol' = 'address'
	) {
		super(status, message);
	}
}

/** Throws the public-mode refusal. Call before any network activity or DNS lookup. */
export function assertOutboundAllowed(): void {
	if (isPublicMode()) throw new OutboundError(PUBLIC_MODE_MESSAGE, 403, 'public');
}

/** Resolves a host name to every address it has (A and AAAA). Replaceable for tests. */
export type Resolver = (host: string) => Promise<string[]>;

const RESOLVE_TIMEOUT_MS = 5000;

const systemResolver: Resolver = async (host) => {
	// getaddrinfo also understands decimal/hex/octal spellings; we judge what it returns.
	const all = await Promise.race([
		lookup(host, { all: true, verbatim: true }),
		new Promise<never>((_, rej) =>
			setTimeout(() => rej(new Error('dns timeout')), RESOLVE_TIMEOUT_MS).unref()
		)
	]);
	return all.map((a) => a.address);
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
}

/** `[::1]` for IPv6, plain for IPv4: the form an address takes inside a URL. */
export const ipForUrl = (ip: string) => (ip.includes(':') ? `[${ip}]` : ip);

/**
 * Check a host and pick the address to connect to. Public mode: refused before any lookup.
 * Every resolved address must be allowed; one bad answer refuses the host.
 */
export async function resolveAllowed(
	rawHost: string,
	r: Resolver = resolver
): Promise<ResolvedTarget> {
	assertOutboundAllowed();
	const host = cleanHost(rawHost);
	if (!host) throw new OutboundError('Enter the printer address.');
	if (isIpLiteral(host)) {
		const v = classifyAddress(host);
		if (!v.ok) throw new OutboundError(refusedMessage(v, rawHost));
		return { host, ip: v.ip, family: v.family === 6 || host.includes(':') ? 6 : 4, literal: true };
	}
	let answers: string[];
	try {
		answers = await r(host);
	} catch {
		throw new OutboundError(`Could not find ${host}. Check the address.`, 400, 'dns');
	}
	if (!answers.length)
		throw new OutboundError(`Could not find ${host}. Check the address.`, 400, 'dns');
	const verdicts = answers.map((a) => classifyAddress(a));
	for (const v of verdicts) if (!v.ok) throw new OutboundError(refusedMessage(v, host));
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

const NULL_BODY = new Set([101, 204, 205, 304]);

type FetchInit = Parameters<typeof fetch>[1];

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
	assertOutboundAllowed();
	if (url.protocol !== 'http:' && url.protocol !== 'https:')
		throw new OutboundError('The address must start with http:// or https://', 400, 'protocol');
	const target = await resolveAllowed(url.hostname);
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
				const h = new Headers();
				for (const [k, v] of Object.entries(res.headers)) {
					if (Array.isArray(v)) for (const x of v) h.append(k, x);
					else if (v !== undefined) h.set(k, v);
				}
				const status = res.statusCode ?? 502;
				if (NULL_BODY.has(status)) {
					res.resume();
					return resolve(new Response(null, { status, headers: h }));
				}
				resolve(
					new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers: h })
				);
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
