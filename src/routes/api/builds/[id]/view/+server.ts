import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { loadBuildView } from '#lib/server/builds/view.ts';
import { requireUserId } from '#lib/server/api.ts';
import { ApiError } from '#lib/server/access.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	let userId: string;
	try {
		userId = requireUserId(event);
	} catch (e) {
		return json({ error: (e as ApiError).message }, { status: 401 });
	}
	const view = loadBuildView(getDb(), event.params.id, userId);
	if (!view) return json({ error: 'Not found' }, { status: 404 });
	return json(view);
};
