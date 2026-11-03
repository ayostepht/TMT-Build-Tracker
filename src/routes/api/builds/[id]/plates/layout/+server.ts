import { getDb } from '#lib/server/db/index.ts';
import { setPlateLayout } from '#lib/server/builds/plates.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	respond(async () =>
		setPlateLayout(getDb(), event.params.id, requireUserId(event), await readJson(event))
	);
