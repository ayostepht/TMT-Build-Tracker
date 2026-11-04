import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { normalizeRole } from '#lib/server/access.ts';
import { getAuth } from '#lib/server/auth-instance.ts';
import { getDb } from '#lib/server/db/index.ts';
import { member, organization } from '#lib/server/db/schema.ts';
import { isPersonalMetadata } from '#lib/server/teams.ts';
import type { LayoutServerLoad } from './$types';

/** Workspace header data shared by the chapter tabs (Builds, Members, Printers, Integrations). */
export const load: LayoutServerLoad = async ({ params, locals, request }) => {
	const db = getDb();
	const org = db.select().from(organization).where(eq(organization.slug, params.slug)).get();
	if (!org) error(404, 'Not found');
	const m = db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, org.id), eq(member.userId, locals.user!.id)))
		.get();
	if (!m) error(404, 'Not found');
	const role = normalizeRole(m.role);

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

	const personal = isPersonalMetadata(org.metadata);
	return {
		team: { id: org.id, name: personal ? 'My builds' : org.name, slug: org.slug, personal },
		role,
		canEdit: role !== 'viewer'
	};
};
