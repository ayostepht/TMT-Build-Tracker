import { redirect } from '@sveltejs/kit';
import { effectiveSignup } from '#lib/server/auth-policy.ts';
import { appMode, oidcConfig, signupMode } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db/index.ts';
import { safeRedirect } from '#lib/server/teams.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const to = safeRedirect(url.searchParams.get('redirect'));
	if (locals.user) redirect(303, to ?? '/');
	const publicMode = appMode() === 'public';
	// Public mode has no password sign-up: Google/GitHub sign-in creates the account.
	if (publicMode) redirect(303, to ? `/login?redirect=${encodeURIComponent(to)}` : '/login');
	const oidc = oidcConfig();
	return {
		sso: oidc ? { providerName: oidc.providerName } : null,
		signup: effectiveSignup(getDb(), { publicMode, signup: signupMode() }),
		redirectTo: to
	};
};
