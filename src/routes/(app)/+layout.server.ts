import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { buildAccess, isSiteAdmin } from '#lib/server/access.ts';
import { recentBuilds } from '#lib/server/builds/list.ts';
import { getAuth } from '#lib/server/auth-instance.ts';
import { mayUseInvitations } from '#lib/server/auth-policy.ts';
import { appMode, isPublicMode, signupMode } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db/index.ts';
import { printerCounts } from '#lib/server/printers/store.ts';
import { builds } from '#lib/server/db/schema.ts';
import {
	ensurePersonalWorkspace,
	findPersonalWorkspace,
	listTeams,
	pendingInvitationCount
} from '#lib/server/teams.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, request }) => {
	if (!locals.user) {
		const back = url.pathname + url.search;
		redirect(303, `/login?redirect=${encodeURIComponent(back)}`);
	}
	const db = getDb();
	// Users from before personal workspaces existed get theirs on first visit.
	if (!findPersonalWorkspace(db, locals.user.id))
		ensurePersonalWorkspace(db, { id: locals.user.id, name: locals.user.name });
	const raw = listTeams(db, locals.user.id);
	const activeId = (locals.session as { activeOrganizationId?: string | null } | null)
		?.activeOrganizationId;
	// Without a valid active workspace, prefer a real chapter (legacy users) over "My builds".
	const fallback = raw.find((t) => !t.personal) ?? raw[0];
	const activeTeamId = raw.find((t) => t.id === activeId)?.id ?? fallback?.id ?? null;
	if (activeTeamId && activeTeamId !== activeId) {
		try {
			await getAuth().api.setActiveOrganization({
				body: { organizationId: activeTeamId },
				headers: request.headers
			});
		} catch {
			/* non-fatal */
		}
	}
	// A personal workspace is shown as "My builds"; its stored name is only a fallback.
	const teams = raw.map((t) => (t.personal ? { ...t, name: 'My builds' } : t));
	// A page reached from a build (`?from=<buildId>`) offers a way back to it.
	const fromId = url.searchParams.get('from');
	let backBuild: { id: string; name: string } | null = null;
	if (fromId && buildAccess(db, fromId, locals.user.id)) {
		const row = db
			.select({ id: builds.id, name: builds.name })
			.from(builds)
			.where(eq(builds.id, fromId))
			.get();
		if (row) backBuild = row;
	}
	const nameOf = new Map(teams.map((t) => [t.id, t.name]));
	return {
		user: { id: locals.user.id, name: locals.user.name, email: locals.user.email },
		teams,
		/** Printers per workspace: the nav's Printers link goes where the printers are. */
		printerCounts: printerCounts(
			db,
			teams.map((t) => t.id)
		),
		activeTeamId,
		/** Install-wide admin (first user or ADMIN_EMAILS): shows the "Kit admin" link. */
		siteAdmin: isSiteAdmin(db, locals.user),
		/** Hosted site: no printers or Spoolman, so the nav hides those links. */
		publicMode: isPublicMode(),
		invitationCount: mayUseInvitations(
			{ publicMode: appMode() === 'public', signup: signupMode() },
			locals.user
		)
			? pendingInvitationCount(db, locals.user.email)
			: 0,
		/** Builds touched most recently across all workspaces, for the Builds menu. */
		recentBuilds: recentBuilds(
			db,
			teams.map((t) => t.id)
		).map((b) => ({
			id: b.id,
			name: b.name,
			progress: b.progress,
			printed: b.printed,
			total: b.total,
			setupStep: b.setupStep,
			workspace: nameOf.get(b.organizationId) ?? ''
		})),
		backBuild
	};
};
