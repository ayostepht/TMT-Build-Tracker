import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import {
	DuplicateFilamentError,
	deleteCustomFilament,
	updateCustomFilament
} from '#lib/server/filaments/custom.ts';
import type { RequestHandler } from './$types';

/** Full replacement of the editable fields (editors). 409 + `existingId` when another filament matches. */
export const PATCH: RequestHandler = async (event) => {
	try {
		const userId = requireUserId(event);
		return json({
			ok: true,
			filament: updateCustomFilament(getDb(), event.params.id, userId, await readJson(event))
		});
	} catch (e) {
		if (e instanceof DuplicateFilamentError)
			return json({ error: e.message, existingId: e.existingId }, { status: 409 });
		return respond(() => {
			throw e;
		});
	}
};

export const DELETE: RequestHandler = (event) =>
	respond(() => deleteCustomFilament(getDb(), event.params.id, requireUserId(event)));
