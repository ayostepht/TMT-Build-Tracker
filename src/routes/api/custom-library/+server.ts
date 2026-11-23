import { getDb } from '#lib/server/db/index.ts';
import { ApiError } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import {
	createLibraryPiece,
	libraryTemplateOptions,
	listLibrary,
	saveToLibrary
} from '#lib/server/custom-library.ts';
import { isObj } from '#lib/domain/guards.ts';
import type { RequestHandler } from './$types';

/**
 * `?organizationId=`: the workspace's saved custom parts (members), and `template`: the default kit's
 * filament roles and parts, for a form that creates a saved part by hand.
 */
export const GET: RequestHandler = (event) =>
	respond(() => {
		const org = event.url.searchParams.get('organizationId');
		if (!org) throw new ApiError(400, 'organizationId is required');
		const userId = requireUserId(event);
		const db = getDb();
		return {
			pieces: listLibrary(db, org, userId),
			template: libraryTemplateOptions(db, org, userId)
		};
	});

/**
 * Two shapes (editors):
 * - `{ buildId, pieceId, isDefault? }`: save a custom piece of a build for new builds.
 * - `{ organizationId, name, fileName?, sliced?, isDefault?, templateId?, replaces?, plates: [{ name?,
 *   estSeconds?, grams?, role, runs?, filamentGrams? }] }`: create a saved part by hand, without a build.
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const body = await readJson(event);
		if (isObj(body) && typeof body.organizationId === 'string' && body.buildId === undefined) {
			const { organizationId, ...input } = body;
			return { piece: createLibraryPiece(getDb(), userId, organizationId, input) };
		}
		if (!isObj(body) || typeof body.buildId !== 'string' || typeof body.pieceId !== 'string')
			throw new ApiError(400, 'buildId and pieceId are required');
		return {
			piece: saveToLibrary(getDb(), userId, body.buildId, body.pieceId, {
				isDefault: body.isDefault as boolean | undefined
			})
		};
	});
