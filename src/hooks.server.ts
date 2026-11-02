import { building } from '$app/env';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { getAuth } from '#lib/server/auth-instance.ts';
import { startup } from '#lib/server/startup.ts';

export const init: ServerInit = () => {
	if (!building) startup();
};

export const handle: Handle = async ({ event, resolve }) => {
	if (building) return resolve(event);
	const auth = getAuth();
	if (event.url.pathname.startsWith('/api/auth/')) return auth.handler(event.request);

	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.session = session?.session ?? null;
	event.locals.user = session?.user ?? null;
	return resolve(event);
};
