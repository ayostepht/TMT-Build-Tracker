import { getDb } from '#lib/server/db/index.ts';
import { ApiError } from '#lib/server/access.ts';
import { createBuild } from '#lib/server/builds/create.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const b = await readJson(event);
		if (typeof b !== 'object' || b === null) throw new ApiError(400, 'Invalid body');
		const o = b as Record<string, unknown>;
		const str = (v: unknown) => (typeof v === 'string' ? v : null);
		if (!str(o.organizationId) || !str(o.templateId) || !str(o.name))
			throw new ApiError(400, 'organizationId, templateId and name are required');
		const id = createBuild(
			getDb(),
			{
				organizationId: o.organizationId as string,
				templateId: o.templateId as string,
				designId: str(o.designId),
				name: o.name as string,
				recipient: str(o.recipient),
				hospital: str(o.hospital),
				deliveryDate: str(o.deliveryDate)
			},
			userId
		);
		return { id };
	});
