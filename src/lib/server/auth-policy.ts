import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db } from './db';
import { invitation, user } from './db/schema';
import type { SignupMode } from './config';

/**
 * Who may get an account and who may use invitations, as pure functions of the database
 * and the configuration. `auth.ts` calls these from Better Auth hooks (the enforcement);
 * the login/signup/invite pages call them to describe the same rules (UI only).
 */

export interface PolicyConfig {
	/** `TMT_MODE=public`: SSO-only, provider-verified emails. */
	publicMode: boolean;
	/** `SIGNUP` (self-hosted only; public mode has no password sign-up). */
	signup: SignupMode;
}

export type NewUserDecision = { ok: true } | { ok: false; code: string; message: string };

export function userCount(db: Db): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(user)
			.get()?.n ?? 0
	);
}

/** A pending, unexpired invitation addressed to this email (case-insensitive). */
export function hasPendingInvitation(db: Db, email: string, now = new Date()): boolean {
	const wanted = email.trim().toLowerCase();
	if (!wanted) return false;
	return db
		.select({ email: invitation.email })
		.from(invitation)
		.where(and(eq(invitation.status, 'pending'), gt(invitation.expiresAt, now)))
		.all()
		.some((i) => i.email.toLowerCase() === wanted);
}

/**
 * Sign-up rule shown to visitors: `open`, `invite` (an invitation link is needed) or
 * `closed`. The very first account on an empty database is always allowed (bootstrap).
 */
export function effectiveSignup(db: Db, cfg: PolicyConfig): SignupMode {
	if (cfg.publicMode) return 'open';
	if (cfg.signup !== 'open' && userCount(db) === 0) return 'open';
	return cfg.signup;
}

/** Decision for `databaseHooks.user.create.before`: covers email sign-up and SSO first login. */
export function decideNewUser(
	db: Db,
	candidate: { email?: string | null; emailVerified?: boolean | null },
	cfg: PolicyConfig,
	now = new Date()
): NewUserDecision {
	if (cfg.publicMode) {
		if (candidate.emailVerified !== true)
			return {
				ok: false,
				code: 'email_not_verified',
				message: 'The sign-in provider did not confirm a verified email address.'
			};
		return { ok: true };
	}
	if (cfg.signup === 'open' || userCount(db) === 0) return { ok: true };
	if (cfg.signup === 'closed')
		return {
			ok: false,
			code: 'signup_closed',
			message: 'Sign-up is closed on this server.'
		};
	if (hasPendingInvitation(db, candidate.email ?? '', now)) return { ok: true };
	return {
		ok: false,
		code: 'invitation_required',
		message: 'Sign-up needs an invitation to this email address.'
	};
}

/** Public mode: invitations are listed and accepted only for provider-verified emails. */
export function mayUseInvitations(
	cfg: PolicyConfig,
	u: { emailVerified?: boolean | null }
): boolean {
	return !cfg.publicMode || u.emailVerified === true;
}

/** Fixed, human messages for the `?error=` codes Better Auth and our hooks send back to /login. */
export function loginErrorMessage(code: string | null | undefined): string | null {
	if (!code) return null;
	const c = code.toLowerCase();
	switch (c) {
		case 'email_not_found':
		case 'email_not_verified':
			return 'Your account has no verified email address we can use. If you signed in with GitHub, add an email address in GitHub (Settings, Emails), verify it, and try again. Google accounts always have one.';
		case 'account_not_linked':
			return 'An account with this email address already exists but is not linked to that sign-in. Sign in the way you created it (email and password), then ask an admin if you need the accounts joined.';
		case 'signup_closed':
		case 'signup_disabled':
			return 'Sign-up is closed on this server. Ask the admin for an account.';
		case 'invitation_required':
			return 'This server only creates accounts for invited people. Open the invitation link you were sent, then sign in with the invited email address.';
		case 'access_denied':
			return 'Sign-in was cancelled.';
		default:
			return 'Sign-in did not complete. Please try again.';
	}
}
