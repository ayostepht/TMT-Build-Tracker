import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.ts';
import { templates } from '#lib/server/db/schema.ts';
import { setSetupStep } from '#lib/server/builds/actions.ts';
import { ApiError } from '#lib/server/access.ts';
import { createBuild } from '#lib/server/builds/create.ts';
import { parsePrinter } from '#lib/printers/printer.ts';
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
		const db = getDb();
		const draft = o.kind === 'draft';
		// A build started from a design goes through the setup wizard too (`setup: false` opts out). The
		// colors are already chosen, so it starts at the first step that still needs input: the kit's
		// options when it has any, else the Files step.
		const wizard = !draft && (o.setup === true || (o.setup !== false && !!str(o.designId)));
		const id = createBuild(
			db,
			{
				organizationId: o.organizationId as string,
				templateId: o.templateId as string,
				designId: str(o.designId),
				name: o.name as string,
				recipient: str(o.recipient),
				hospital: str(o.hospital),
				deliveryDate: str(o.deliveryDate),
				plateLayout: str(o.plateLayout),
				kind: draft ? 'draft' : 'build',
				setup: wizard,
				printer: o.printer == null ? null : parsePrinterInput(o.printer),
				variantChoices:
					typeof o.variantChoices === 'object' && o.variantChoices !== null
						? (o.variantChoices as Record<string, string>)
						: null
			},
			userId
		);
		if (wizard && str(o.designId)) {
			const tpl = db
				.select({ groups: templates.variantGroups })
				.from(templates)
				.where(eq(templates.id, o.templateId as string))
				.get();
			setSetupStep(db, id, userId, { step: tpl?.groups?.length ? 2 : 4 });
		}
		return { id };
	});

function parsePrinterInput(v: unknown) {
	try {
		return parsePrinter(v);
	} catch (e) {
		throw new ApiError(400, (e as Error).message);
	}
}
