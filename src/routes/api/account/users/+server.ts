import { json } from '@sveltejs/kit';
import { ApiError } from '#lib/server/access.ts';
import { requireUserId } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { searchUsers } from '#lib/server/site-admins.ts';
import type { RequestHandler } from './$types';

/** Accounts for the site-admin picker (`?q=` filters by name or email). Site admins only: 403 for everyone else. */
export const GET: RequestHandler = (event) => {
	try {
		requireUserId(event);
		const users = searchUsers(getDb(), event.locals.user!, event.url.searchParams.get('q') ?? '');
		return json({ users }, { headers: { 'cache-control': 'no-store' } });
	} catch (e) {
		if (e instanceof ApiError) return json({ error: e.message }, { status: e.status });
		console.error('[tmt] user list failed', e);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
