import { fail, redirect } from '@sveltejs/kit';
import { ApiError } from '#lib/server/access.ts';
import { createBuild } from '#lib/server/builds/create.ts';
import { getDb } from '#lib/server/db/index.ts';
import { defaultTemplate } from '#lib/server/templates/fork.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { teams, activeTeamId } = await parent();
	const writable = teams.filter((t) => t.role !== 'viewer');
	const wanted = url.searchParams.get('team');
	const pick =
		writable.find((t) => t.slug === wanted) ??
		writable.find((t) => t.id === activeTeamId) ??
		writable[0];
	return { workspaces: writable, workspaceId: pick?.id ?? null };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const f = await request.formData();
		const s = (k: string) => String(f.get(k) ?? '').trim() || null;
		const db = getDb();
		let id: string;
		try {
			id = createBuild(
				db,
				{
					organizationId: s('organizationId') ?? '',
					templateId: defaultTemplate(db).id,
					designId: null,
					name: s('name') ?? '',
					recipient: s('recipient'),
					hospital: s('hospital'),
					setup: true
				},
				locals.user!.id
			);
		} catch (e) {
			if (e instanceof ApiError) return fail(e.status, { error: e.message });
			throw e;
		}
		redirect(303, `/builds/${id}/setup`);
	}
};
