import { building } from '$app/env';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import type { RequestEvent } from '@sveltejs/kit';
import { getAuth } from '#lib/server/auth-instance.ts';
import { startup } from '#lib/server/startup.ts';
import { compressResponse } from '#lib/server/compress.ts';
import {
	authRequestHeaders,
	shouldWarnUndeclaredProxy,
	UNDECLARED_PROXY_WARNING
} from '#lib/server/client-ip.ts';
import { bodyLimitWarning, bootProblems, trustedProxy } from '#lib/server/config.ts';
import {
	bodyCapFor,
	declaredTooLarge,
	limitRequest,
	tooLargeResponse
} from '#lib/server/body-limits.ts';
import { securityHeaders, withHeaders } from '#lib/server/security-headers.ts';

export const init: ServerInit = () => {
	if (building) return;
	// Fail at boot, not with a 500 on every request: a container with a bad secret or an
	// unsafe public-mode setup must not look healthy. Messages never contain the secret.
	const problems = bootProblems();
	if (problems.length) {
		console.error('[tmt] Refusing to start: configuration problems');
		for (const p of problems) console.error(`[tmt]   - ${p}`);
		process.exit(1);
	}
	const warning = bodyLimitWarning();
	if (warning) console.warn(`[tmt] ${warning}`);
	startup();
};

let lastClientIpWarning = 0;
let proxyHintLogged = false;

/**
 * Better Auth rate-limits per client IP from X-Forwarded-For; see `authRequestHeaders`.
 * Null means no trustworthy client address (proxy header missing, depth too large): the
 * auth request is refused instead of falling back to anything the client sent.
 */
function withClientIp(event: RequestEvent): Request | null {
	const headers = authRequestHeaders(event.request.headers, () => event.getClientAddress());
	if (!headers) return null;
	return new Request(event.request, { headers });
}

/** Runs the app: body cap, sign-in routing, session, page rendering and gzip. Headers are added by `handle`. */
const handleRequest: Handle = async ({ event, resolve }) => {
	// Cap the body before anything reads it. A declared length over the cap is refused outright;
	// otherwise the stream is wrapped so a chunked or lying client errors at the cap.
	const { cap } = bodyCapFor(event.request.method, event.url.pathname);
	const isApi = event.url.pathname.startsWith('/api/');
	if (event.request.body) {
		if (declaredTooLarge(event.request.headers, cap)) return tooLargeResponse(cap, isApi, true);
		const limited = limitRequest(event.request, cap);
		// `request` is typed read-only, but it is a plain property of the event object SvelteKit passes on.
		(event as { request: Request }).request = limited.request;
		const res = await handleLimited(event, resolve);
		// A handler that did not turn the stream error into a 413 (a form action: SvelteKit answers 500) still refuses.
		if (limited.exceeded() && res.status !== 413) return tooLargeResponse(cap, isApi, false);
		return res;
	}
	return handleLimited(event, resolve);
};

const handleLimited = async (event: RequestEvent, resolve: Parameters<Handle>[0]['resolve']) => {
	const auth = getAuth();
	if (shouldWarnUndeclaredProxy(event.request.headers, trustedProxy() !== null, proxyHintLogged)) {
		proxyHintLogged = true;
		console.warn(UNDECLARED_PROXY_WARNING);
	}
	if (event.url.pathname.startsWith('/api/auth/')) {
		const request = withClientIp(event);
		if (!request) {
			// Once a minute is enough to notice a misconfigured proxy; nothing client-controlled is logged.
			if (Date.now() - lastClientIpWarning > 60_000) {
				lastClientIpWarning = Date.now();
				console.error(
					'[tmt] auth request refused: no client address (check ADDRESS_HEADER / XFF_DEPTH and that the proxy sets the header)'
				);
			}
			return new Response('Bad request', { status: 400 });
		}
		return auth.handler(request);
	}

	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.session = session?.session ?? null;
	event.locals.user = session?.user ?? null;
	return compressResponse(event.request, await resolve(event));
};

export const handle: Handle = async (input) => {
	if (building) return input.resolve(input.event);
	const res = await handleRequest(input);
	return withHeaders(
		res,
		securityHeaders({
			pathname: input.event.url.pathname,
			// proxy-origin.mjs makes the URL's scheme the PUBLIC_URL scheme or the proxy's X-Forwarded-Proto.
			https: input.event.url.protocol === 'https:',
			contentType: res.headers.get('content-type'),
			hasCsp: res.headers.has('content-security-policy')
		})
	);
};
