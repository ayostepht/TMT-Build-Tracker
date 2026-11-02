import { redirect } from '@sveltejs/kit';
import { oidcConfig } from '#lib/server/config.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
	const oidc = oidcConfig();
	return { sso: oidc ? { providerName: oidc.providerName } : null };
};
