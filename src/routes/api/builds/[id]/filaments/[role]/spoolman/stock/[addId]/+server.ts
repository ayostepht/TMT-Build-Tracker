import { requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { removeSpoolmanSpoolAdd } from '#lib/server/spoolman/create.ts';
import type { RequestHandler } from './$types';

/** Remove a history entry; `?archive=1` also archives its Spoolman spool. Editors. */
export const DELETE: RequestHandler = (event) =>
	respond(async () =>
		removeSpoolmanSpoolAdd(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.role,
			event.params.addId,
			event.url.searchParams.get('archive') === '1'
		)
	);
