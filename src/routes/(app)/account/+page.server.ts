import { fail, redirect } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { ApiError } from '#lib/server/access.ts';
import {
	AccountDeletionError,
	deleteAccount,
	planAccountDeletion,
	siteBlock
} from '#lib/server/account.ts';
import { getAuth } from '#lib/server/auth-instance.ts';
import { isPublicMode } from '#lib/server/config.ts';
import { isSiteAdmin } from '#lib/server/access.ts';
import { grantSiteAdmin, listSiteAdmins, revokeSiteAdmin } from '#lib/server/site-admins.ts';
import { getDb } from '#lib/server/db/index.ts';
import { account, builds } from '#lib/server/db/schema.ts';
import type { Actions, PageServerLoad } from './$types';

/** Without a password to type (SSO), the session must be this young to delete an account. */
const FRESH_SESSION_MS = 10 * 60 * 1000;

function passwordHash(userId: string): string | null {
	return (
		getDb()
			.select({ password: account.password })
			.from(account)
			.where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
			.get()?.password ?? null
	);
}

const freshSession = (session: { createdAt: Date } | null) =>
	!!session && Date.now() - new Date(session.createdAt).getTime() < FRESH_SESSION_MS;

/** Wrong-password attempts per user, so a hijacked session cannot guess the password here. */
const failures = new Map<string, { n: number; since: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

function tooManyAttempts(userId: string): boolean {
	const f = failures.get(userId);
	if (!f || Date.now() - f.since > WINDOW_MS) {
		failures.delete(userId);
		return false;
	}
	return f.n >= MAX_FAILURES;
}

function noteFailure(userId: string) {
	const f = failures.get(userId);
	if (!f || Date.now() - f.since > WINDOW_MS) failures.set(userId, { n: 1, since: Date.now() });
	else f.n++;
}

export const load: PageServerLoad = ({ locals }) => {
	const u = locals.user!;
	const db = getDb();
	const fates = planAccountDeletion(db, u.id);
	const personal = fates.find((f) => f.fate === 'personal');
	const personalBuilds = personal
		? (db
				.select({ n: sql<number>`count(*)` })
				.from(builds)
				.where(eq(builds.organizationId, personal.orgId))
				.get()?.n ?? 0)
		: 0;
	const usesPassword = !isPublicMode() && passwordHash(u.id) !== null;
	const site = siteBlock(db, u.id);
	const isAdmin = isSiteAdmin(db, u);
	return {
		isAdmin,
		/** Site admins and where each role comes from; only site admins get the list. */
		siteAdmins: isAdmin ? listSiteAdmins(db, u) : [],
		/** `last_admin`, `only_account` or null: refused for site-wide reasons. */
		siteBlock: site?.code ?? null,
		siteBlockMessage: site?.message ?? null,
		email: u.email,
		name: u.name,
		usesPassword,
		/** Passwordless accounts must have signed in within the last 10 minutes. */
		needsRecentSignIn: !usesPassword && !freshSession(locals.session),
		personalBuilds,
		deletedChapters: fates.filter((f) => f.fate === 'delete').map((f) => f.name),
		leftChapters: fates.filter((f) => f.fate === 'leave').map((f) => f.name),
		blockedChapters: fates.filter((f) => f.fate === 'blocked').map((f) => f.name)
	};
};

export const actions: Actions = {
	grant: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const id = String((await request.formData()).get('userId') ?? '');
		try {
			grantSiteAdmin(getDb(), locals.user, id);
		} catch (e) {
			if (e instanceof ApiError) return fail(e.status, { adminError: e.message });
			throw e;
		}
		return { granted: true };
	},
	revoke: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const id = String((await request.formData()).get('userId') ?? '');
		try {
			revokeSiteAdmin(getDb(), locals.user, id);
		} catch (e) {
			if (e instanceof ApiError) return fail(e.status, { adminError: e.message });
			throw e;
		}
		return { revoked: true };
	},
	delete: async ({ request, locals }) => {
		const u = locals.user;
		if (!u) redirect(303, '/login');
		const f = await request.formData();
		const typed = String(f.get('email') ?? '')
			.trim()
			.toLowerCase();
		if (typed !== u.email.trim().toLowerCase())
			return fail(400, { error: 'Type your account email exactly as shown to confirm.' });

		const hash = isPublicMode() ? null : passwordHash(u.id);
		if (hash) {
			if (tooManyAttempts(u.id))
				return fail(429, { error: 'Too many wrong passwords. Wait a few minutes and try again.' });
			const password = String(f.get('password') ?? '');
			const ctx = await getAuth().$context;
			if (!password || !(await ctx.password.verify({ hash, password }))) {
				noteFailure(u.id);
				return fail(400, { error: 'That password is not right.' });
			}
			failures.delete(u.id);
		} else if (!freshSession(locals.session)) {
			return fail(403, {
				error: 'For your safety, sign in again, then delete your account within 10 minutes.',
				signInAgain: true
			});
		}

		try {
			await deleteAccount(getDb(), u.id);
		} catch (e) {
			if (e instanceof AccountDeletionError)
				return fail(e.status, { error: e.message, code: e.code });
			if (e instanceof ApiError) return fail(e.status, { error: e.message });
			console.error('[tmt] account deletion failed', e);
			return fail(500, { error: 'Could not delete the account. Nothing was changed.' });
		}
		redirect(303, '/login?notice=deleted');
	}
};
