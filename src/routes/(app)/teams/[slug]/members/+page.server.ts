import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { APIError } from 'better-auth/api';
import { normalizeRole } from '#lib/server/access.ts';
import { getAuth } from '#lib/server/auth-instance.ts';
import { getDb } from '#lib/server/db/index.ts';
import { invitation, member, organization, user } from '#lib/server/db/schema.ts';
import { isPersonalMetadata } from '#lib/server/teams.ts';
import type { Actions, PageServerLoad } from './$types';

function teamFor(slug: string, userId: string) {
	const db = getDb();
	const org = db.select().from(organization).where(eq(organization.slug, slug)).get();
	if (!org) error(404, 'Not found');
	const m = db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, org.id), eq(member.userId, userId)))
		.get();
	if (!m) error(404, 'Not found');
	return { org, role: normalizeRole(m.role) };
}

export const load: PageServerLoad = ({ params, locals }) => {
	const { org, role } = teamFor(params.slug, locals.user!.id);
	// A personal workspace has no members to manage.
	if (isPersonalMetadata(org.metadata)) redirect(303, `/teams/${org.slug}`);
	const db = getDb();
	const members = db
		.select({
			id: member.id,
			userId: member.userId,
			name: user.name,
			email: user.email,
			role: member.role
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(eq(member.organizationId, org.id))
		.all()
		.map((m) => ({ ...m, role: normalizeRole(m.role) }));

	const invites =
		role === 'owner'
			? db
					.select({
						id: invitation.id,
						email: invitation.email,
						role: invitation.role,
						expiresAt: invitation.expiresAt
					})
					.from(invitation)
					.where(and(eq(invitation.organizationId, org.id), eq(invitation.status, 'pending')))
					.all()
					.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))
			: [];
	return { members, invites };
};

function authFail(e: unknown) {
	const msg = e instanceof APIError || e instanceof Error ? e.message : 'Something went wrong';
	return fail(400, { error: msg });
}

export const actions: Actions = {
	invite: async ({ request, params, locals }) => {
		const { org, role } = teamFor(params.slug, locals.user!.id);
		if (role !== 'owner') return fail(403, { error: 'Only owners can invite' });
		if (isPersonalMetadata(org.metadata))
			return fail(400, { error: 'Create a chapter to invite people' });
		const f = await request.formData();
		const email = String(f.get('email') ?? '')
			.trim()
			.toLowerCase();
		const r = String(f.get('role') ?? 'viewer');
		if (!email || !['editor', 'viewer'].includes(r))
			return fail(400, { error: 'Email and role required' });
		try {
			const inv = await getAuth().api.createInvitation({
				body: { email, role: r as 'editor', organizationId: org.id },
				headers: request.headers
			});
			return { invited: { id: inv.id, email } };
		} catch (e) {
			return authFail(e);
		}
	},

	revoke: async ({ request, params, locals }) => {
		const { role } = teamFor(params.slug, locals.user!.id);
		if (role !== 'owner') return fail(403, { error: 'Only owners can do this' });
		const invitationId = String((await request.formData()).get('id') ?? '');
		try {
			await getAuth().api.cancelInvitation({ body: { invitationId }, headers: request.headers });
		} catch (e) {
			return authFail(e);
		}
	},

	setRole: async ({ request, params, locals }) => {
		const { org, role } = teamFor(params.slug, locals.user!.id);
		if (role !== 'owner') return fail(403, { error: 'Only owners can do this' });
		const f = await request.formData();
		const r = String(f.get('role') ?? '');
		if (!['owner', 'editor', 'viewer'].includes(r)) return fail(400, { error: 'Unknown role' });
		try {
			await getAuth().api.updateMemberRole({
				body: {
					memberId: String(f.get('memberId') ?? ''),
					role: r as 'editor',
					organizationId: org.id
				},
				headers: request.headers
			});
		} catch (e) {
			return authFail(e);
		}
	},

	remove: async ({ request, params, locals }) => {
		const { org, role } = teamFor(params.slug, locals.user!.id);
		if (role !== 'owner') return fail(403, { error: 'Only owners can do this' });
		const memberId = String((await request.formData()).get('memberId') ?? '');
		try {
			await getAuth().api.removeMember({
				body: { memberIdOrEmail: memberId, organizationId: org.id },
				headers: request.headers
			});
		} catch (e) {
			return authFail(e);
		}
	}
};
