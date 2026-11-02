import { json, type RequestEvent } from '@sveltejs/kit';
import { ApiError } from './access';

export function requireUserId(event: RequestEvent): string {
	if (!event.locals.user) throw new ApiError(401, 'Sign in required');
	return event.locals.user.id;
}

export async function readJson(event: RequestEvent): Promise<unknown> {
	try {
		return await event.request.json();
	} catch {
		throw new ApiError(400, 'Invalid JSON');
	}
}

/** Run a handler body, mapping ApiError to `{ error }` JSON with its status. */
export async function respond(fn: () => unknown | Promise<unknown>): Promise<Response> {
	try {
		const out = await fn();
		return json({ ok: true, ...(out && typeof out === 'object' ? out : {}) });
	} catch (e) {
		if (e instanceof ApiError) return json({ error: e.message }, { status: e.status });
		console.error('[tmt] api error', e);
		return json({ error: 'Internal error' }, { status: 500 });
	}
}
