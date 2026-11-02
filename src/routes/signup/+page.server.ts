import { redirect } from '@sveltejs/kit';
import { oidcConfig } from '#lib/server/config.ts';
import { safeRedirect } from '#lib/server/teams.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const to = safeRedirect(url.searchParams.get('redirect'));
	if (locals.user) redirect(303, to ?? '/');
	const oidc = oidcConfig();
	return { sso: oidc ? { providerName: oidc.providerName } : null, redirectTo: to };
};
