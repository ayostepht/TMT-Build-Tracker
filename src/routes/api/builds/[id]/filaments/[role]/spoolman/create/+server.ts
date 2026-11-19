import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { createAndLinkFilament, createFormFor } from '#lib/server/spoolman/create.ts';
import type { RequestHandler } from './$types';

/** Prefill for "Create in Spoolman" (catalog values) and Spoolman's vendors. Editors. */
export const GET: RequestHandler = (event) =>
	respond(() => createFormFor(getDb(), event.params.id, requireUserId(event), event.params.role));

/**
 * Create the vendor (if missing) and the filament in Spoolman, then link the slot to it. Editors.
 * Body: `{ vendorName, name, material, colorHex, density, weightG, spoolWeightG?, diameter?, externalId? }`.
 */
export const POST: RequestHandler = (event) =>
	respond(async () =>
		createAndLinkFilament(
			getDb(),
			event.params.id,
			requireUserId(event),
			event.params.role,
			await readJson(event)
		)
	);
