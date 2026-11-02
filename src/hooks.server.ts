import { building } from '$app/env';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import type { RequestEvent } from '@sveltejs/kit';
import { getAuth } from '#lib/server/auth-instance.ts';
import { startup } from '#lib/server/startup.ts';

export const init: ServerInit = () => {
	if (!building) startup();
};

/**
 * Better Auth rate-limits per client IP, taken from X-Forwarded-For. The Node adapter
 * hands over a plain Request without it, so direct connections (no proxy) would all
 * share one bucket and a few sign-ins from different people could lock each other out.
 * Add the socket address when the header is absent; a proxy's own header is left alone.
 */
function withClientIp(event: RequestEvent): Request {
	if (event.request.headers.has('x-forwarded-for')) return event.request;
	try {
		const headers = new Headers(event.request.headers);
		headers.set('x-forwarded-for', event.getClientAddress());
		return new Request(event.request, { headers });
	} catch {
		return event.request;
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	if (building) return resolve(event);
	const auth = getAuth();
	if (event.url.pathname.startsWith('/api/auth/')) return auth.handler(withClientIp(event));

	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.session = session?.session ?? null;
	event.locals.user = session?.user ?? null;
	return resolve(event);
};
