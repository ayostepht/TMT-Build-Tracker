import { redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { listTeams } from '#lib/server/teams.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user) {
		const back = url.pathname + url.search;
		redirect(303, `/login?redirect=${encodeURIComponent(back)}`);
	}
	const teams = listTeams(getDb(), locals.user.id);
	const path = url.pathname;
	if (!teams.length && !path.startsWith('/onboarding') && !path.startsWith('/invite'))
		redirect(303, '/onboarding');
	const activeId = (locals.session as { activeOrganizationId?: string | null } | null)
		?.activeOrganizationId;
	const activeTeamId = teams.find((t) => t.id === activeId)?.id ?? teams[0]?.id ?? null;
	return {
		user: { id: locals.user.id, name: locals.user.name, email: locals.user.email },
		teams,
		activeTeamId
	};
};
