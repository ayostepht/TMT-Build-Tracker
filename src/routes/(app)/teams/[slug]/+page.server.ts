import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { APIError } from 'better-auth/api';
import { normalizeRole, ApiError } from '#lib/server/access.ts';
import { getAuth } from '#lib/server/auth-instance.ts';
import { createBuild } from '#lib/server/builds/create.ts';
import { getDb } from '#lib/server/db/index.ts';
import { isPersonalMetadata } from '#lib/server/teams.ts';
import {
	buildParts,
	builds,
	colorDesigns,
	invitation,
	member,
	organization,
	templates,
	user
} from '#lib/server/db/schema.ts';
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

export const load: PageServerLoad = async ({ params, locals, request }) => {
	const { org, role } = teamFor(params.slug, locals.user!.id);
	const db = getDb();

	const active = (locals.session as { activeOrganizationId?: string | null } | null)
		?.activeOrganizationId;
	if (active !== org.id) {
		try {
			await getAuth().api.setActiveOrganization({
				body: { organizationId: org.id },
				headers: request.headers
			});
		} catch {
			/* non-fatal */
		}
	}

	const buildRows = db
		.select({
			id: builds.id,
			name: builds.name,
			phase: builds.phase,
			deliveryDate: builds.deliveryDate,
			total: sql<number>`(select count(*) from ${buildParts} where ${buildParts.buildId} = ${builds.id})`,
			printed: sql<number>`(select count(*) from ${buildParts} where ${buildParts.buildId} = ${builds.id} and ${buildParts.status} = 'Printed')`
		})
		.from(builds)
		.where(eq(builds.organizationId, org.id))
		.orderBy(sql`${builds.createdAt} desc`)
		.all()
		.map((b) => ({ ...b, progress: b.total ? Math.round((b.printed / b.total) * 100) : 0 }));

	const tpls = db.select({ id: templates.id, name: templates.name }).from(templates).all();
	const designs = db
		.select({ id: colorDesigns.id, name: colorDesigns.name, templateId: colorDesigns.templateId })
		.from(colorDesigns)
		.where(eq(colorDesigns.isPublic, true))
		.orderBy(asc(colorDesigns.name))
		.all();

	const personal = isPersonalMetadata(org.metadata);
	const members = personal
		? []
		: db
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

	const invites = personal
		? []
		: role === 'owner'
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

	return {
		team: { id: org.id, name: personal ? 'My builds' : org.name, slug: org.slug, personal },
		role,
		canEdit: role !== 'viewer',
		builds: buildRows,
		templates: tpls,
		designs,
		members,
		invites
	};
};

function authFail(e: unknown) {
	const msg = e instanceof APIError || e instanceof Error ? e.message : 'Something went wrong';
	return fail(400, { error: msg });
}

export const actions: Actions = {
	newBuild: async ({ request, params, locals }) => {
		const { org } = teamFor(params.slug, locals.user!.id);
		const f = await request.formData();
		const s = (k: string) => String(f.get(k) ?? '').trim() || null;
		let id: string;
		try {
			id = createBuild(
				getDb(),
				{
					organizationId: org.id,
					templateId: s('templateId') ?? '',
					designId: s('designId'),
					name: s('name') ?? '',
					recipient: s('recipient'),
					hospital: s('hospital'),
					deliveryDate: s('deliveryDate')
				},
				locals.user!.id
			);
		} catch (e) {
			if (e instanceof ApiError) return fail(e.status, { error: e.message });
			throw e;
		}
		redirect(303, `/builds/${id}`);
	},

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
