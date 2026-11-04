import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { ApiError } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import {
	DuplicateFilamentError,
	createCustomFilament,
	listCustomFilaments
} from '#lib/server/filaments/custom.ts';
import type { RequestHandler } from './$types';

/** `?organizationId=`: the workspace's custom filaments (members). */
export const GET: RequestHandler = (event) =>
	respond(() => {
		const org = event.url.searchParams.get('organizationId');
		if (!org) throw new ApiError(400, 'organizationId is required');
		return { filaments: listCustomFilaments(getDb(), org, requireUserId(event)) };
	});

/** `{ organizationId, brand, material, colorName, hex, finish?, hardness?, url?, notes? }` (editors). 409 + `existingId` on a duplicate. */
export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUserId(event);
		const body = (await readJson(event)) as { organizationId?: unknown };
		if (typeof body?.organizationId !== 'string')
			throw new ApiError(400, 'organizationId is required');
		return json({
			ok: true,
			filament: createCustomFilament(getDb(), body.organizationId, userId, body)
		});
	} catch (e) {
		if (e instanceof DuplicateFilamentError)
			return json({ error: e.message, existingId: e.existingId }, { status: 409 });
		return respond(() => {
			throw e;
		});
	}
};
