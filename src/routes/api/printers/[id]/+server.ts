import { ApiError, requireEditor } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { deletePrinter, getPrinter, toPublic, updatePrinter } from '#lib/server/printers/store.ts';
import { getSupervisor } from '#lib/server/printers/supervisor.ts';
import type { RequestHandler } from './$types';

function orgOf(id: string, userId: string): string {
	const db = getDb();
	const p = getPrinter(db, id);
	if (!p) throw new ApiError(404, 'Not found');
	requireEditor(db, p.organizationId, userId); // 404 for non-members, 403 for viewers
	return p.organizationId;
}

export const PATCH: RequestHandler = (event) =>
	respond(async () => {
		const org = orgOf(event.params.id, requireUserId(event));
		const row = updatePrinter(getDb(), event.params.id, org, await readJson(event));
		getSupervisor()?.refresh(row.id);
		return { printer: toPublic(row) };
	});

export const DELETE: RequestHandler = (event) =>
	respond(() => {
		const org = orgOf(event.params.id, requireUserId(event));
		deletePrinter(getDb(), event.params.id, org);
		getSupervisor()?.remove(event.params.id);
	});
