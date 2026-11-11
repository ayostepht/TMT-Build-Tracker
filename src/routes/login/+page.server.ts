import { redirect } from '@sveltejs/kit';
import { effectiveSignup, loginErrorMessage } from '#lib/server/auth-policy.ts';
import { appMode, oidcConfig, signupMode, socialProviders } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db/index.ts';
import { safeRedirect } from '#lib/server/teams.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const to = safeRedirect(url.searchParams.get('redirect'));
	if (locals.user) redirect(303, to ?? '/');
	const publicMode = appMode() === 'public';
	const oidc = publicMode ? null : oidcConfig();
	const social = socialProviders();
	return {
		publicMode,
		// Public mode: SSO-only with these providers. Self-hosted: the optional OIDC button.
		providers: publicMode ? (['google', 'github'] as const).filter((p) => social[p]) : [],
		sso: oidc ? { providerName: oidc.providerName } : null,
		signup: effectiveSignup(getDb(), { publicMode, signup: signupMode() }),
		redirectTo: to,
		// Fixed texts only: the query string never reaches the page as text.
		authError: loginErrorMessage(url.searchParams.get('error'))
	};
};
