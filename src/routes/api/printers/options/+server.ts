import { connectionOptionsFor } from '#lib/printers/connection-options.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import { isPublicMode } from '#lib/server/config.ts';
import type { RequestHandler } from './$types';

/**
 * The ways a printer can be added, with the fields each needs and whether this site offers it
 * (`hosted` follows `TMT_MODE`). Any signed-in user; nothing here is workspace data.
 */
export const GET: RequestHandler = (event) =>
	respond(() => {
		requireUserId(event);
		const hosted = isPublicMode();
		return { hosted, connectionOptions: connectionOptionsFor(hosted) };
	});
