// Runtime configuration read from environment variables. Kept free of SvelteKit
// imports so it can be used from tests and tooling.
const env = process.env;
const isProd = env.NODE_ENV === 'production';

export function databaseUrl(): string {
	return env.DATABASE_URL || (isProd ? '/data/tmt.db' : './data/tmt.db');
}

export function baseUrl(): string {
	return env.BETTER_AUTH_URL || env.ORIGIN || 'http://localhost:5173';
}

export function authSecret(): string {
	if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
	if (isProd && env.npm_lifecycle_event !== 'build') {
		throw new Error(
			'BETTER_AUTH_SECRET must be set in production (use e.g. `openssl rand -base64 32`).'
		);
	}
	return 'dev-only-insecure-secret-change-me-0123456789';
}

export interface OidcConfig {
	issuer: string;
	clientId: string;
	clientSecret: string;
	providerName: string;
}

export function oidcConfig(): OidcConfig | null {
	const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_PROVIDER_NAME } = env;
	if (!OIDC_ISSUER || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) return null;
	return {
		issuer: OIDC_ISSUER.replace(/\/+$/, ''),
		clientId: OIDC_CLIENT_ID,
		clientSecret: OIDC_CLIENT_SECRET,
		providerName: OIDC_PROVIDER_NAME || 'SSO'
	};
}
