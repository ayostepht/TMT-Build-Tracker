import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { normalizeRole } from '#lib/server/access.ts';
import { isPublicMode } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db/index.ts';
import { member, organization } from '#lib/server/db/schema.ts';
import { isPersonalMetadata } from '#lib/server/teams.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
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
	const personal = isPersonalMetadata(org.metadata);
	return {
		team: { id: org.id, slug: org.slug, name: personal ? 'My builds' : org.name },
		canEdit: role !== 'viewer',
		// Hosted (public) site: no printer or camera connection is ever made, so no forms are offered.
		printersAvailable: !isPublicMode()
	};
};
