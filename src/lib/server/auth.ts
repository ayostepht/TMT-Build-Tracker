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
import { decideNewUser, mayUseInvitations, userCount, type PolicyConfig } from './auth-policy';
import * as schema from './db/schema';
import { user as userTable } from './db/schema';
import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { APIError } from 'better-auth/api';
import {
	assertCanAddMember,
	assertCanCreateChapter,
	assertCanInvite,
	assertCanJoinChapter,
	buildCount,
	ensurePersonalWorkspace,
	listTeams,
	isPersonalMetadata,
	isPersonalOrg
} from './teams';
import {
	emptyPlan,
	planFiles,
	removePlannedFiles,
	deleteOwnedTemplates,
	type FilePlan
} from './account';
import { repointBuildsOffTemplates } from './builds/repoint';
import { QuotaError, quotaLimit } from './quota';

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

/**
 * Organization endpoints nothing in the app calls. `/organization/update` could rewrite a
 * workspace's metadata (the `personal` flag) and slug; `/leave` and `/check-slug` have no UI.
 * Disabled for every mode. (Team and dynamic-role endpoints are not registered at all because
 * those plugin options are off.) Everything else the app uses goes through the quota hooks below.
 */
export const ORGANIZATION_DISABLED_PATHS = [
	'/organization/update',
	'/organization/leave',
	'/organization/check-slug'
];

/** Quota refusals reach Better Auth callers as 409 `QUOTA` with the sentence as the message. */
function quotaGuard(fn: () => void): void {
	try {
		fn();
	} catch (e) {
		if (e instanceof QuotaError)
			throw new APIError('CONFLICT', { code: 'QUOTA', message: e.message });
		throw e;
	}
}

/**
 * Number handed back to the plugin's own limit check, which runs right after ours with no await
 * between them in practice. Our check already passed (so the user is under the limit or exempt as a
 * site admin): a configured limit must not trip the plugin's count for an admin, an unset one keeps
 * the plugin's historical default of 100.
 */
const plugin = (limit: number | null) => (limit === null ? 100 : Number.MAX_SAFE_INTEGER);

export function createAuth(db: Db) {
	const publicMode = isPublicMode();
	const policy: PolicyConfig = { publicMode, signup: signupMode() };
	/** In-flight bootstrap sign-up (see user.create.before); expires so a failed attempt cannot lock it. */
	const BOOTSTRAP_CLAIM_MS = 30_000;
	let bootstrapClaimedAt = 0;
	/** Files of chapters being deleted, between the plugin's before and after hooks. */
	const pendingFiles = new Map<string, { plan: FilePlan; at: number }>();
	/** A failed delete never reaches the after hook: entries older than this are dropped on the next delete. */
	const PENDING_FILES_MS = 120_000;
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
		// Reset links are minted only by the operator CLI (scripts/reset-password-link.mjs); finishing
		// one also signs the user out everywhere.
		emailAndPassword: {
			enabled: !publicMode,
			minPasswordLength: 8,
			revokeSessionsOnPasswordReset: true
		},
		...(publicMode ? { socialProviders: social } : {}),
		disabledPaths: [...(publicMode ? PASSWORD_PATHS : []), ...ORGANIZATION_DISABLED_PATHS],
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
						// Bootstrap race: with SIGNUP=closed|invite the "empty database" exception lets
						// one account through, but the user-count check and the insert are separated by
						// awaits, so two simultaneous first sign-ups could both pass. The check and this
						// claim run in one synchronous stretch (one Node process), so only one wins.
						if (!policy.publicMode && policy.signup !== 'open' && userCount(db) === 0) {
							if (bootstrapClaimedAt && Date.now() - bootstrapClaimedAt < BOOTSTRAP_CLAIM_MS)
								throw new APIError('FORBIDDEN', {
									code: 'signup_closed',
									message: 'Sign-up is closed on this server.'
								});
							bootstrapClaimedAt = Date.now();
						}
					},
					// Every account (email, OIDC, invited) gets a personal workspace.
					after: async (u) => {
						bootstrapClaimedAt = 0;
						ensurePersonalWorkspace(db, { id: u.id, name: u.name });
					}
				}
			},
			session: {
				create: {
					before: async (session) => {
						// Public mode: no session for an unverified email, checked before any early return.
						if (publicMode) {
							const v = db
								.select({ emailVerified: userTable.emailVerified })
								.from(userTable)
								.where(eq(userTable.id, session.userId))
								.get();
							if (!v?.emailVerified)
								throw new APIError('FORBIDDEN', {
									code: 'email_not_verified',
									message: 'Your email address is not verified.'
								});
						}
						if ((session as { activeOrganizationId?: string | null }).activeOrganizationId) return;
						// The user's after-create hook may not have run yet; ensure is idempotent.
						const u = db
							.select({ name: userTable.name, emailVerified: userTable.emailVerified })
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
				// The plugin checks these before its own hooks, and they are its hard bounds (our hooks
				// cannot share a transaction with the plugin's insert). The checks throw our sentence.
				// Personal workspaces are not chapters and never reach the plugin's endpoints.
				organizationLimit: async (u) => {
					quotaGuard(() => assertCanCreateChapter(db, u.id));
					return false;
				},
				membershipLimit: async (u, org) => {
					quotaGuard(() => assertCanAddMember(db, u.id, org.id));
					return plugin(quotaLimit('membersPerChapter'));
				},
				invitationLimit: async ({ user: u, organization: org }) => {
					quotaGuard(() => assertCanInvite(db, u.id, org.id));
					return plugin(quotaLimit('pendingInvitesPerChapter'));
				},
				// Public mode: accepting, declining and reading an invitation needs a verified
				// email (Better Auth checks this on the invitation routes).
				requireEmailVerificationOnInvitation: publicMode,
				organizationHooks: {
					// Belt and braces for the option above, on the accept path itself.
					beforeAcceptInvitation: async ({ user: u, organization: org }) => {
						if (!mayUseInvitations(policy, u))
							throw new APIError('FORBIDDEN', {
								message: 'Verify your email address before accepting an invitation'
							});
						quotaGuard(() => assertCanJoinChapter(db, u.id, org.id));
					},
					// Personal workspaces are created by the server only.
					beforeCreateOrganization: async ({ organization: org, user: u }) => {
						if (isPersonalMetadata(org.metadata))
							throw new APIError('BAD_REQUEST', { message: 'Reserved organization metadata' });
						quotaGuard(() => assertCanCreateChapter(db, u.id));
					},
					// Server-side adds (no HTTP route): same caps as joining.
					beforeAddMember: async ({ user: u, organization: org }) => {
						if (isPersonalOrg(db, org.id)) return;
						quotaGuard(() => assertCanAddMember(db, u.id, org.id));
					},
					beforeCreateInvitation: async ({ organization: org, inviter }) => {
						if (isPersonalMetadata(org.metadata) || isPersonalOrg(db, org.id))
							throw new APIError('BAD_REQUEST', {
								message: 'Create a chapter to invite people; My builds is just for you'
							});
						quotaGuard(() => assertCanInvite(db, inviter.id, org.id));
					},
					beforeDeleteOrganization: async ({ organization: org }) => {
						if (
							(isPersonalMetadata(org.metadata) || isPersonalOrg(db, org.id)) &&
							buildCount(db, org.id) > 0
						)
							throw new APIError('BAD_REQUEST', {
								message: 'Move or delete the builds in My builds first'
							});
						// The rows cascade away with the chapter; list their files first, remove them after.
						const plan = planFiles(db, { orgIds: [org.id] });
						// Builds in other workspaces that use this chapter's kit copies go back to the base kit.
						repointBuildsOffTemplates(db, plan.templateIds);
						deleteOwnedTemplates(db, plan.templateIds);
						const now = Date.now();
						for (const [k, v] of pendingFiles)
							if (now - v.at > PENDING_FILES_MS) pendingFiles.delete(k);
						pendingFiles.set(org.id, { plan, at: now });
					},
					afterDeleteOrganization: async ({ organization: org }) => {
						const plan: FilePlan = pendingFiles.get(org.id)?.plan ?? emptyPlan();
						pendingFiles.delete(org.id);
						await removePlannedFiles(plan);
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
