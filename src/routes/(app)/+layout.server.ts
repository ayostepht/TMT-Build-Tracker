import { redirect } from '@sveltejs/kit';
import { getAuth } from '#lib/server/auth-instance.ts';
import { getDb } from '#lib/server/db/index.ts';
import {
	ensurePersonalWorkspace,
	findPersonalWorkspace,
	listTeams,
	pendingInvitationCount
} from '#lib/server/teams.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, request }) => {
	if (!locals.user) {
		const back = url.pathname + url.search;
		redirect(303, `/login?redirect=${encodeURIComponent(back)}`);
	}
	const db = getDb();
	// Users from before personal workspaces existed get theirs on first visit.
	if (!findPersonalWorkspace(db, locals.user.id))
		ensurePersonalWorkspace(db, { id: locals.user.id, name: locals.user.name });
	const raw = listTeams(db, locals.user.id);
	const activeId = (locals.session as { activeOrganizationId?: string | null } | null)
		?.activeOrganizationId;
	// Without a valid active workspace, prefer a real chapter (legacy users) over "My builds".
	const fallback = raw.find((t) => !t.personal) ?? raw[0];
	const activeTeamId = raw.find((t) => t.id === activeId)?.id ?? fallback?.id ?? null;
	if (activeTeamId && activeTeamId !== activeId) {
		try {
			await getAuth().api.setActiveOrganization({
				body: { organizationId: activeTeamId },
				headers: request.headers
			});
		} catch {
			/* non-fatal */
		}
	}
	// A personal workspace is shown as "My builds"; its stored name is only a fallback.
	const teams = raw.map((t) => (t.personal ? { ...t, name: 'My builds' } : t));
	return {
		user: { id: locals.user.id, name: locals.user.name, email: locals.user.email },
		teams,
		activeTeamId,
		invitationCount: pendingInvitationCount(db, locals.user.email)
	};
};
