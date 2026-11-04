import { ApiError, buildAccess } from '#lib/server/access.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { buildFilaments } from '#lib/server/db/schema.ts';
import { getOrgSettings } from '#lib/server/org-settings.ts';
import { SpoolmanClient, SpoolmanError, type SpoolSummary } from '#lib/server/spoolman/client.ts';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Spoolman state for a build: whether the team has it set up, the linked spools (remaining
 * grams) and, with `?all=1`, every spool for the picker. Unreachable Spoolman is reported in
 * `error`, not as a failed request, so the page keeps working.
 */
export const GET: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const access = buildAccess(db, event.params.id, requireUserId(event));
		if (!access) throw new ApiError(404, 'Not found');
		const cfg = getOrgSettings(db, access.organizationId);
		if (!cfg.spoolmanUrl) return { configured: false, autoDeduct: false, linked: {}, spools: [] };
		const links = db
			.select({ role: buildFilaments.roleKey, id: buildFilaments.spoolmanSpoolId })
			.from(buildFilaments)
			.where(eq(buildFilaments.buildId, event.params.id))
			.all()
			.filter((l) => l.id != null) as { role: string; id: number }[];
		try {
			const client = new SpoolmanClient(cfg.spoolmanUrl);
			const all = event.url.searchParams.get('all') === '1';
			const spools: SpoolSummary[] = await client.listSpools();
			const linked: Record<string, SpoolSummary | null> = {};
			for (const l of links) linked[l.role] = spools.find((s) => s.id === l.id) ?? null;
			return {
				configured: true,
				autoDeduct: cfg.spoolmanAutoDeduct,
				linked,
				spools: all ? spools : []
			};
		} catch (e) {
			return {
				configured: true,
				autoDeduct: cfg.spoolmanAutoDeduct,
				linked: {},
				spools: [],
				error: e instanceof SpoolmanError ? e.message : 'Spoolman failed'
			};
		}
	});
