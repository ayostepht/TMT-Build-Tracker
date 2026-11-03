import { getDb } from '#lib/server/db/index.ts';
import { createDesign, listDesigns } from '#lib/server/designs/designs.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Designs the signed-in user may see (public, own, and from people in their workspaces). */
export const GET: RequestHandler = (event) =>
	respond(async () => ({
		designs: await listDesigns(getDb(), requireUserId(event), {
			templateId: event.url.searchParams.get('templateId') ?? undefined
		})
	}));

/** `{ buildId, name, isPublic? }`: save the build's current colors as a design. */
export const POST: RequestHandler = (event) =>
	respond(async () => createDesign(getDb(), requireUserId(event), await readJson(event)));
