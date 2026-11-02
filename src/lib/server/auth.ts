import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth, organization } from 'better-auth/plugins';
import { ac, roles } from '../permissions';
import { authSecret, baseUrl, oidcConfig } from './config';
import * as schema from './db/schema';
import type { Db } from './db';

export function createAuth(db: Db) {
	const oidc = oidcConfig();
	return betterAuth({
		baseURL: baseUrl(),
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
