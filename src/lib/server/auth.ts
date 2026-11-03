import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth, organization } from 'better-auth/plugins';
import { ac, roles } from '../permissions';
import { authSecret, oidcConfig, publicUrl } from './config';
import * as schema from './db/schema';
import { user as userTable } from './db/schema';
import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { APIError } from 'better-auth/api';
import {
	buildCount,
	ensurePersonalWorkspace,
	listTeams,
	isPersonalMetadata,
	isPersonalOrg
} from './teams';

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
		databaseHooks: {
			user: {
				create: {
					// Every account (email, OIDC, invited) gets a personal workspace.
					after: async (u) => {
						ensurePersonalWorkspace(db, { id: u.id, name: u.name });
					}
				}
			},
			session: {
				create: {
					before: async (session) => {
						if ((session as { activeOrganizationId?: string | null }).activeOrganizationId) return;
						// The user's after-create hook may not have run yet; ensure is idempotent.
						const u = db
							.select({ name: userTable.name })
							.from(userTable)
							.where(eq(userTable.id, session.userId))
							.get();
						if (!u) return;
						const { id } = ensurePersonalWorkspace(db, { id: session.userId, name: u.name });
						// Users who already belong to chapters keep their own default (see the app layout).
						if (listTeams(db, session.userId).some((t) => !t.personal)) return;
						return { data: { ...session, activeOrganizationId: id } };
					}
				}
			}
		},
		plugins: [
			organization({
				ac,
				roles,
				creatorRole: 'owner',
				organizationHooks: {
					// Personal workspaces are created by the server only.
					beforeCreateOrganization: async ({ organization: org }) => {
						if (isPersonalMetadata(org.metadata))
							throw new APIError('BAD_REQUEST', { message: 'Reserved organization metadata' });
					},
					beforeCreateInvitation: async ({ organization: org }) => {
						if (isPersonalMetadata(org.metadata) || isPersonalOrg(db, org.id))
							throw new APIError('BAD_REQUEST', {
								message: 'Create a chapter to invite people; My builds is just for you'
							});
					},
					beforeDeleteOrganization: async ({ organization: org }) => {
						if (
							(isPersonalMetadata(org.metadata) || isPersonalOrg(db, org.id)) &&
							buildCount(db, org.id) > 0
						)
							throw new APIError('BAD_REQUEST', {
								message: 'Move or delete the builds in My builds first'
							});
					}
				}
			}),
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
