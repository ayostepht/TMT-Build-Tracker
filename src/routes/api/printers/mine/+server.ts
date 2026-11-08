import { requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { listPrinters, toPublic } from '#lib/server/printers/store.ts';
import { listTeams } from '#lib/server/teams.ts';
import type { RequestHandler } from './$types';

/**
 * The signed-in user's printers across every workspace they are a member of, grouped by workspace
 * (the `first` workspace, when given and a member, leads; then the rest by name). Members only,
 * and like the per-team list it never includes secrets.
 */
export const GET: RequestHandler = (event) =>
	respond(() => {
		const db = getDb();
		const userId = requireUserId(event);
		const first = event.url.searchParams.get('first');
		const teams = listTeams(db, userId).sort(
			(a, b) => Number(b.id === first) - Number(a.id === first)
		);
		return {
			workspaces: teams.map((t) => ({
				id: t.id,
				name: t.personal ? 'My builds' : t.name,
				personal: t.personal,
				canEdit: t.role !== 'viewer',
				printers: listPrinters(db, t.id).map((p) => toPublic(p, t.role !== 'viewer'))
			}))
		};
	});
