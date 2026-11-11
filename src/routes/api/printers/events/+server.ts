import { json } from '@sveltejs/kit';
import { getMemberRole } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { liveStream, sessionStillValid } from '#lib/server/live-stream.ts';
import { subscribePrinterEvents } from '#lib/server/printers/bus.ts';
import { acquireSseSlot, QuotaError } from '#lib/server/quota.ts';
import type { RequestHandler } from './$types';

/** Team-level server-sent events: live printer status and job changes. */
export const GET: RequestHandler = (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Sign in required' }, { status: 401 });
	const db = getDb();
	const sessionId = event.locals.session?.id;
	const org = event.url.searchParams.get('org') ?? '';
	if (!org || !getMemberRole(db, org, user.id))
		return json({ error: 'Not found' }, { status: 404 });

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
		subscribe: (fn) => subscribePrinterEvents(org, fn),
		allowed: () => !!getMemberRole(db, org, user.id),
		sessionValid: () => sessionStillValid(db, sessionId),
		release
	});
};
