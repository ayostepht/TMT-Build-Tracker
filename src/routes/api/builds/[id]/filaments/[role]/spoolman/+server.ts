import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { setFilamentLink, suggestFilaments } from '#lib/server/spoolman/link.ts';
import type { RequestHandler } from './$types';

/** Spoolman filaments ranked for this slot (any member). Unreachable Spoolman: `offline` with the cached ones. */
export const GET: RequestHandler = (event) =>
	respond(() =>
		suggestFilaments(getDb(), event.params.id, requireUserId(event), event.params.role)
	);

/** Link the slot to a Spoolman filament (`{ filamentId }`) or unlink it (`{ filamentId: null }`). Editors. */
export const PUT: RequestHandler = (event) =>
	respond(async () =>
		setFilamentLink(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.role,
			await readJson(event)
		)
	);
