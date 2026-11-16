import { getDb } from '#lib/server/db/index.ts';
import { removeSpoolAdd } from '#lib/server/builds/actions.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Remove one earlier add from a color's stock. Editors and owners. */
export const DELETE: RequestHandler = (event) =>
	respond(async () =>
		removeSpoolAdd(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.role,
			event.params.addId
		)
	);
