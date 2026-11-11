import { shareLinkOf } from '#lib/printers/share-link.ts';
import { ApiError, requireEditor } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { resolveAllowed } from '#lib/server/printers/outbound.ts';
import { configFromInput } from '#lib/server/printers/store.ts';
import { testConnection } from '#lib/server/printers/supervisor.ts';
import type { RequestHandler } from './$types';

/** Connect once with the typed (or stored) settings and report a live status snapshot. */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const userId = requireUserId(event);
		const body = (await readJson(event)) as Record<string, unknown>;
		const org = typeof body?.organizationId === 'string' ? body.organizationId : '';
		if (!org) throw new ApiError(400, 'organizationId is required');
		requireEditor(db, org, userId);
		const cfg = configFromInput(db, org, body);
		// 4xx with a clear message in public mode or for a non-local address. Through an
		// OctoEverywhere link the destination is the link's host (a validated public address).
		const link = cfg.kind === 'elegoo-sdcp' ? shareLinkOf(cfg.secrets) : null;
		await resolveAllowed(link ? link.host : cfg.host);
		const r = await testConnection(cfg);
		return { connected: r.ok, status: r.status, message: r.message };
	});
