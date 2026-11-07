import { fail, redirect } from '@sveltejs/kit';
import { ApiError } from '#lib/server/access.ts';
import { createBuild } from '#lib/server/builds/create.ts';
import { draftRows } from '#lib/server/builds/list.ts';
import { getDb } from '#lib/server/db/index.ts';
import { listTemplatesFor } from '#lib/server/templates/fork.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { teams, activeTeamId } = await parent();
	const db = getDb();
	const writable = teams.filter((t) => t.role !== 'viewer');
	const nameOf = new Map(teams.map((t) => [t.id, t.name]));
	const drafts = draftRows(
		db,
		teams.map((t) => t.id)
	).map((d) => ({ ...d, workspace: nameOf.get(d.organizationId) ?? '' }));
	return {
		drafts,
		workspaces: writable.map((t) => ({
			id: t.id,
			name: t.name,
			templates: listTemplatesFor(db, t.id).map((tp) => ({ id: tp.id, name: tp.name }))
		})),
		workspaceId: writable.find((t) => t.id === activeTeamId)?.id ?? writable[0]?.id ?? null
	};
};

/** "Draft 1", "Draft 2", ...: the first number not already used by a draft in the workspace. */
function nextDraftName(taken: string[]): string {
	const used = new Set(taken.map((n) => n.toLowerCase()));
	for (let i = 1; ; i++) if (!used.has(`draft ${i}`)) return `Draft ${i}`;
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const f = await request.formData();
		const s = (k: string) => String(f.get(k) ?? '').trim();
		const db = getDb();
		const orgId = s('organizationId');
		const taken = draftRows(db, [orgId]).map((d) => d.name);
		let id: string;
		try {
			id = createBuild(
				db,
				{
					organizationId: orgId,
					templateId: s('templateId'),
					designId: null,
					name: s('name') || nextDraftName(taken),
					kind: 'draft'
				},
				locals.user!.id
			);
		} catch (e) {
			if (e instanceof ApiError) return fail(e.status, { error: e.message });
			throw e;
		}
		redirect(303, `/builds/${id}/design`);
	}
};
