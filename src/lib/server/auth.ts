import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth, organization } from 'better-auth/plugins';
import { ac, roles } from '../permissions';
import { authSecret, oidcConfig, publicUrl } from './config';
import * as schema from './db/schema';
import type { Db } from './db';

function sameOrigin(request?: Request): string[] {
	if (!request) return [];
	try {
		return [new URL(request.url).origin];
	} catch {
		return [];
	}
}

export function createAuth(db: Db) {
	const oidc = oidcConfig();
	const url = publicUrl();
	return betterAuth({
		// With PUBLIC_URL set, that origin is the only trusted one. Without it, the
		// origin of each request (resolved by scripts/proxy-origin.mjs from Host /
		// X-Forwarded-*) is trusted, so plain http://<lan-ip>:3000 and a proxied https
		// URL both work. Cookies are only marked Secure when PUBLIC_URL is https,
		// because the scheme is fixed when the server starts.
		...(url ? { baseURL: url } : { trustedOrigins: sameOrigin }),
		advanced: { useSecureCookies: url ? url.startsWith('https://') : false },
		secret: authSecret(),
		database: drizzleAdapter(db, { provider: 'sqlite', schema }),
		emailAndPassword: { enabled: true, minPasswordLength: 8 },
		plugins: [
			organization({ ac, roles, creatorRole: 'owner' }),
			...(oidc
				? [
						genericOAuth({
							config: [
								{
									providerId: 'oidc',
									discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
									clientId: oidc.clientId,
									clientSecret: oidc.clientSecret,
									scopes: ['openid', 'profile', 'email']
								}
							]
						})
					]
				: [])
		]
	});
}

export type Auth = ReturnType<typeof createAuth>;
