import { ApiError } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { markHandedOff, updateHandoff } from '#lib/server/builds/handoff.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Save the handoff form: any of recipientName, organization, contact, handedOffOn, location, notes, safetyChecked. */
export const PATCH: RequestHandler = (event) =>
	respond(async () =>
		updateHandoff(getDb(), event.params.id, requireUserId(event), await readJson(event))
	);

/** Mark the chair as handed off (also saves any form fields in the body) and move the build to `done`. */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const text = await event.request.text();
		let body: unknown = {};
		if (text.trim()) {
			try {
				body = JSON.parse(text);
			} catch {
				throw new ApiError(400, 'Invalid JSON');
			}
		}
		markHandedOff(getDb(), event.params.id, requireUserId(event), body);
	});
