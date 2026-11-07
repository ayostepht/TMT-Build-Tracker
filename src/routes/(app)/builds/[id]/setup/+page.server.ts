import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.ts';
import { templates } from '#lib/server/db/schema.ts';
import { listDesigns } from '#lib/server/designs/designs.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const { view } = await parent();
	// The wizard changes things; view-only members just see the build.
	if (view.build.kind === 'draft') redirect(303, `/builds/${view.build.id}/design`);
	if (!view.canEdit) redirect(303, `/builds/${view.build.id}`);
	const db = getDb();
	const cur = db
		.select({ id: templates.id, base: templates.baseTemplateId })
		.from(templates)
		.where(eq(templates.id, view.build.templateId))
		.get();
	const baseTemplateId = cur?.base ?? cur?.id ?? view.build.templateId;
	// Saved and shared designs that fit this build's kit (a workspace's own copy starts with none).
	const designs = (
		await listDesigns(db, locals.user!.id, { templateId: view.build.templateId })
	).map((d) => ({
		id: d.id,
		name: d.name,
		authorName: d.authorName,
		mine: d.mine,
		roles: d.roles.map((r) => ({ key: r.key, hex: r.hex }))
	}));
	return { baseTemplateId, designs };
};
