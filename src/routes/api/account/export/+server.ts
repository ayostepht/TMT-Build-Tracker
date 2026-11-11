import { json } from '@sveltejs/kit';
import { exportAccountData } from '#lib/server/account.ts';
import { ApiError } from '#lib/server/access.ts';
import { requireUserId } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import type { RequestHandler } from './$types';

/** The signed-in user's own data as one JSON download (profile, memberships, personal builds). */
export const GET: RequestHandler = (event) => {
	try {
		const body = exportAccountData(getDb(), requireUserId(event));
		return new Response(body, {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': 'attachment; filename="tmt-my-data.json"',
				'cache-control': 'no-store'
			}
		});
	} catch (e) {
		if (e instanceof ApiError) return json({ error: e.message }, { status: e.status });
		console.error('[tmt] account export failed', e);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
