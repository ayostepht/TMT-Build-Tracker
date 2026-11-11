import { fail, redirect } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { getAuth } from '#lib/server/auth-instance.ts';
import { mayUseInvitations } from '#lib/server/auth-policy.ts';
import { appMode, signupMode } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db/index.ts';
import { invitation, organization, user } from '#lib/server/db/schema.ts';
import { slugify } from '#lib/server/teams.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const email = locals.user!.email.toLowerCase();
	// Public mode: only a provider-verified email may see or accept invitations.
	if (
		!mayUseInvitations({ publicMode: appMode() === 'public', signup: signupMode() }, locals.user!)
	)
		return { invitations: [] };
	const invitations = getDb()
		.select({
			id: invitation.id,
			role: invitation.role,
			email: invitation.email,
			team: organization.name,
			inviter: user.name
		})
		.from(invitation)
		.innerJoin(organization, eq(organization.id, invitation.organizationId))
		.innerJoin(user, eq(user.id, invitation.inviterId))
		.where(and(eq(invitation.status, 'pending'), gt(invitation.expiresAt, new Date())))
		.all()
		.filter((i) => i.email.toLowerCase() === email);
	return { invitations };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Give your chapter a name' });
		const db = getDb();
		let slug = slugify(name);
		if (
			db.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug)).get()
		)
			slug = `${slug}-${crypto.randomUUID().slice(0, 4)}`;
		try {
			await getAuth().api.createOrganization({
				body: { name, slug },
				headers: request.headers
			});
		} catch (e) {
			return fail(400, { error: (e as Error).message || 'Could not create chapter' });
		}
		redirect(303, `/teams/${slug}`);
	}
};
