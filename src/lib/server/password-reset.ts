/**
 * One-time password reset links, minted by the server operator on the command line
 * (`scripts/reset-password-link.mjs`). No email is ever sent. The token is a Better Auth
 * `reset-password:<token>` verification row, completed through Better Auth's own
 * `POST /api/auth/reset-password`.
 */
import { generateId } from '@better-auth/core/utils/id';
import { and, eq, like, sql } from 'drizzle-orm';
import type { Auth } from './auth';
import { isPublicMode } from './config';
import type { Db } from './db';
import { account, user as userTable, verification } from './db/schema';

export const RESET_TTL_MS = 60 * 60 * 1000;
const PREFIX = 'reset-password:';

/** A refusal with a one-line reason, safe to print. */
export class ResetRefused extends Error {}

/** `--url` value: an http(s) origin without path, query or fragment. Returns the origin. */
export function parseOrigin(raw: string): string {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		throw new ResetRefused(
			'--url must be an http:// or https:// origin such as http://192.168.1.10:3000'
		);
	}
	if (
		(u.protocol !== 'http:' && u.protocol !== 'https:') ||
		u.username ||
		u.password ||
		u.search ||
		u.hash ||
		(u.pathname !== '/' && u.pathname !== '') ||
		/^https?:\/\/[^/]*[?#]/i.test(raw)
	)
		throw new ResetRefused(
			'--url must be an origin only: http(s)://host[:port], no path or credentials'
		);
	return u.origin;
}

export interface ResetLink {
	url: string;
	expiresAt: Date;
}

/**
 * Mint a link for the user with this email. Refuses in public mode, for unknown emails and for
 * users without an email/password account (SSO users must keep signing in with SSO: Better
 * Auth would otherwise create a credential account on reset). Deletes older reset tokens for
 * the user and revokes their sessions right away.
 * `origin` is the app's public origin (already validated).
 */
export async function createResetLink(
	db: Db,
	auth: Auth,
	email: string,
	origin: string,
	now = new Date()
): Promise<ResetLink> {
	if (isPublicMode())
		throw new ResetRefused(
			'Public mode has no passwords: nothing to reset (sign in with Google or GitHub).'
		);
	const wanted = email.trim().toLowerCase();
	if (!wanted) throw new ResetRefused('Give the account email address.');
	const u = db
		.select({ id: userTable.id })
		.from(userTable)
		.where(sql`lower(${userTable.email}) = ${wanted}`)
		.get();
	if (!u) throw new ResetRefused('No account with that email address.');
	const cred = db
		.select({ id: account.id, password: account.password })
		.from(account)
		.where(and(eq(account.userId, u.id), eq(account.providerId, 'credential')))
		.get();
	if (!cred?.password)
		throw new ResetRefused(
			'That account has no password (it signs in with SSO); nothing to reset.'
		);

	const ctx = await auth.$context;
	// Older links for this user die first (row value = user id).
	db.delete(verification)
		.where(and(eq(verification.value, u.id), like(verification.identifier, `${PREFIX}%`)))
		.run();
	// Same generator as Better Auth's own request-password-reset (24 random a-zA-Z0-9 chars).
	const token = generateId(24);
	const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
	await ctx.internalAdapter.createVerificationValue({
		value: u.id,
		identifier: `${PREFIX}${token}`,
		expiresAt
	});
	await ctx.internalAdapter.deleteUserSessions(u.id);
	return { url: `${origin}/reset-password#token=${token}`, expiresAt };
}
