import { building } from '$app/env';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import type { RequestEvent } from '@sveltejs/kit';
import { getAuth } from '#lib/server/auth-instance.ts';
import { startup } from '#lib/server/startup.ts';
import { compressResponse } from '#lib/server/compress.ts';
import { authRequestHeaders } from '#lib/server/client-ip.ts';
import { bootProblems } from '#lib/server/config.ts';

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
	startup();
};

let lastClientIpWarning = 0;

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

export const handle: Handle = async ({ event, resolve }) => {
	if (building) return resolve(event);
	const auth = getAuth();
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
