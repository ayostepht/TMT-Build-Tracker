import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { listLibrary } from '#lib/server/custom-library.ts';
import { getDb } from '#lib/server/db/index.ts';
import { member, organization } from '#lib/server/db/schema.ts';
import { withReplacedNames } from '#lib/server/library-names.ts';
import type { PageServerLoad } from './$types';

/** The workspace's saved custom parts (members only; the layout already 404s everyone else). */
export const load: PageServerLoad = ({ params, locals }) => {
	const db = getDb();
	const org = db.select().from(organization).where(eq(organization.slug, params.slug)).get();
	if (!org) error(404, 'Not found');
	const m = db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, org.id), eq(member.userId, locals.user!.id)))
		.get();
	if (!m) error(404, 'Not found');
	return { pieces: withReplacedNames(db, listLibrary(db, org.id, locals.user!.id)) };
};
