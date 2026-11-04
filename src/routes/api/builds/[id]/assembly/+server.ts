import { getDb } from '#lib/server/db/index.ts';
import { setAssemblyItem } from '#lib/server/builds/assembly.ts';
import { ApiError } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** `{ itemKey, done?, note? }`: tick/untick a step, check or hardware item, or edit its note (editor or owner). */
export const PATCH: RequestHandler = (event) =>
	respond(async () => {
		const body = await readJson(event);
		if (typeof body !== 'object' || body === null || Array.isArray(body))
			throw new ApiError(400, 'Invalid body');
		const { itemKey, done, note } = body as Record<string, unknown>;
		setAssemblyItem(getDb(), event.params.id, requireUserId(event), itemKey, { done, note });
	});
