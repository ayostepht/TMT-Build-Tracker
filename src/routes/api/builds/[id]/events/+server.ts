import { json } from '@sveltejs/kit';
import { buildAccess } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { subscribeBuildEvents } from '#lib/server/events.ts';
import { liveStream, sessionStillValid } from '#lib/server/live-stream.ts';
import { acquireSseSlot, QuotaError } from '#lib/server/quota.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Sign in required' }, { status: 401 });
	const db = getDb();
	const sessionId = event.locals.session?.id;
	const buildId = event.params.id;
	if (!buildAccess(db, buildId, user.id)) return json({ error: 'Not found' }, { status: 404 });

	let release: () => void;
	try {
		release = acquireSseSlot(db, user);
	} catch (e) {
		if (e instanceof QuotaError)
			return json({ error: e.message, code: e.code }, { status: e.status });
		throw e;
	}
	return liveStream({
		signal: event.request.signal,
		subscribe: (fn) => subscribeBuildEvents(buildId, fn),
		allowed: () => !!buildAccess(db, buildId, user.id),
		sessionValid: () => sessionStillValid(db, sessionId),
		release
	});
};
