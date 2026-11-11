import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth, organization } from 'better-auth/plugins';
import { ac, roles } from '../permissions';
import {
	authSecret,
	isPublicMode,
	oidcConfig,
	publicUrl,
	signupMode,
	socialProviders
} from './config';
import { decideNewUser, mayUseInvitations, type PolicyConfig } from './auth-policy';
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

/**
 * Better Auth routes that exist only for passwords. In public mode (SSO-only) none of them
 * may answer, whatever the `emailAndPassword` flag says. `disabledPaths` matches exactly, so
 * `/reset-password/:token` cannot be listed; it needs a token from `/request-password-reset`,
 * which is disabled, and no reset mail is ever sent.
 */
export const PASSWORD_PATHS = [
	'/sign-up/email',
	'/sign-in/email',
	'/request-password-reset',
	'/reset-password',
	'/change-password',
	'/change-email',
	'/set-password',
	'/verify-password',
	'/send-verification-email',
	'/verify-email'
];

export function createAuth(db: Db) {
	const publicMode = isPublicMode();
	const policy: PolicyConfig = { publicMode, signup: signupMode() };
	const social = publicMode ? socialProviders() : {};
	const oidc = publicMode ? null : oidcConfig();
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
		// Public mode is SSO-only (Google, GitHub): no passwords, no generic OIDC.
		emailAndPassword: { enabled: !publicMode, minPasswordLength: 8 },
		...(publicMode ? { socialProviders: social, disabledPaths: PASSWORD_PATHS } : {}),
		// Failures of the OAuth round trip land on the login page, which turns the code into
		// a fixed message. Linking stays on Better Auth's safe default (provider email verified
		// AND local email verified); do not add trustedProviders.
		onAPIError: { errorURL: '/login' },
		rateLimit: {
			enabled: publicMode || process.env.NODE_ENV === 'production',
			window: 60,
			max: 120,
			...(publicMode
				? {
						customRules: {
							'/sign-in/*': { window: 60, max: 10 },
							'/callback/*': { window: 60, max: 20 },
							'/link-social': { window: 60, max: 10 }
						}
					}
				: {})
		},
		databaseHooks: {
			user: {
				create: {
					// Public: provider-verified email only. Self-hosted: the SIGNUP switch.
					// Runs for email sign-up and SSO first login alike.
					before: async (u) => {
						const d = decideNewUser(db, u, policy);
						if (!d.ok) throw new APIError('FORBIDDEN', { code: d.code, message: d.message });
					},
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
							.select({ name: userTable.name, emailVerified: userTable.emailVerified })
							.from(userTable)
							.where(eq(userTable.id, session.userId))
							.get();
						if (!u) return;
						// Public mode: no session for an account whose email is not provider-verified.
						if (publicMode && !u.emailVerified)
							throw new APIError('FORBIDDEN', {
								code: 'email_not_verified',
								message: 'Your email address is not verified.'
							});
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
				// Public mode: accepting, declining and reading an invitation needs a verified
				// email (Better Auth checks this on the invitation routes).
				requireEmailVerificationOnInvitation: publicMode,
				organizationHooks: {
					// Belt and braces for the option above, on the accept path itself.
					beforeAcceptInvitation: async ({ user: u }) => {
						if (!mayUseInvitations(policy, u))
							throw new APIError('FORBIDDEN', {
								message: 'Verify your email address before accepting an invitation'
							});
					},
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
