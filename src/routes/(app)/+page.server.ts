import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { teams, activeTeamId } = await parent();
	const team = teams.find((t) => t.id === activeTeamId);
	redirect(303, team ? `/teams/${team.slug}` : '/onboarding');
};
