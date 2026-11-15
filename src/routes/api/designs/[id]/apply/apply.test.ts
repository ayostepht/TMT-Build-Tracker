import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, runMigrations } from '#lib/server/db/index.ts';
import { member, organization, templates, user } from '#lib/server/db/schema.ts';
import { templateSeeds } from '#lib/server/seed/index.ts';
import { seedTemplates } from '#lib/server/seed/run.ts';
import { createBuild } from '#lib/server/builds/create.ts';
import { setPartStatus } from '#lib/server/builds/actions.ts';
import { createDesign } from '#lib/server/designs/designs.ts';
import { PATCH as PATCH_DESIGN } from '../../../builds/[id]/design/+server.ts';
import { POST } from './+server.ts';

// Issue #56: the request/response bodies of applying a design to a build that has started printing.

let designId: string;
let templateId: string;
const orgId = 'org1';

const ev = (params: Record<string, string>, body: unknown) =>
	({
		request: new Request('http://x.test/api', {
			method: 'POST',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' }
		}),
		locals: { user: { id: 'owner' } },
		params,
		url: new URL('http://x.test/api')
	}) as never;
const post = (buildId: string, extra: Record<string, unknown> = {}) =>
	POST(ev({ id: designId }, { buildId, ...extra }));
const mkBuild = () =>
	createBuild(getDb(), { organizationId: orgId, templateId, designId: null, name: 'B' }, 'owner');

beforeAll(() => {
	vi.stubEnv('DATABASE_URL', join(mkdtempSync(join(tmpdir(), 'tmt-apply-')), 'tmt.db'));
	const db = getDb();
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	db.insert(user).values({ id: 'owner', name: 'Olive', email: 'o@example.test' }).run();
	db.insert(member)
		.values({
			id: 'm1',
			organizationId: orgId,
			userId: 'owner',
			role: 'owner',
			createdAt: new Date()
		})
		.run();
	const src = mkBuild();
	designId = createDesign(db, 'owner', { buildId: src, name: 'Source', isPublic: true }).id;
});

describe('POST /api/designs/[id]/apply', () => {
	it('not started: no mode needed', async () => {
		const res = await post(mkBuild());
		expect(res.status).toBe(200);
	});

	it('started and no mode: 409 build-started with started and summary', async () => {
		const id = mkBuild();
		setPartStatus(getDb(), id, 'owner', 'handle-left', { status: 'Reprint' });
		const res = await post(id);
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.code).toBe('build-started');
		expect(body.started).toMatchObject({ started: true });
		expect(body.summary).toMatch(/part/);
	});

	it('rejects a bad mode and a missing buildId', async () => {
		expect((await post(mkBuild(), { mode: 'nope' })).status).toBe(400);
		expect((await POST(ev({ id: designId }, {}))).status).toBe(400);
	});

	it('dry run answers the plan and the full-mode block, and writes nothing', async () => {
		const id = mkBuild();
		setPartStatus(getDb(), id, 'owner', 'handle-left', { status: 'Printing' });
		const res = await post(id, { dryRun: true });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			ok: true,
			started: { started: true },
			skipped: [],
			keptStock: []
		});
		expect(Array.isArray(body.changes)).toBe(true);
		expect(body.fullBlocked).toMatch(/printing/);
	});

	it('colors mode answers { changed, skipped, keptStock }; full needs confirm and no printing plate', async () => {
		const id = mkBuild();
		setPartStatus(getDb(), id, 'owner', 'handle-left', { status: 'Reprint' });
		const colors = await post(id, { mode: 'colors' });
		expect(colors.status).toBe(200);
		expect(await colors.json()).toMatchObject({ ok: true, skipped: [], keptStock: [] });
		expect((await post(id, { mode: 'full' })).status).toBe(409);
		expect((await post(id, { mode: 'full', confirm: true })).status).toBe(200);
		const printing = mkBuild();
		setPartStatus(getDb(), printing, 'owner', 'handle-left', { status: 'Printing' });
		const refused = await post(printing, { mode: 'full', confirm: true });
		expect(refused.status).toBe(409);
		expect((await refused.json()).code).toBe('build-started');
	});
});

describe('PATCH /api/builds/[id]/design palette reset', () => {
	const pal = {
		label: 'P',
		reset: true,
		slots: { primary: { name: 'Orange', material: 'PETG', hex: '#ff8800' } }
	};
	it('409 build-started without confirm on a started build, 200 with it', async () => {
		const id = mkBuild();
		setPartStatus(getDb(), id, 'owner', 'handle-left', { status: 'Reprint' });
		const res = await PATCH_DESIGN(ev({ id }, { palette: pal }));
		expect(res.status).toBe(409);
		expect((await res.json()).code).toBe('build-started');
		expect((await PATCH_DESIGN(ev({ id }, { palette: pal, confirm: true }))).status).toBe(200);
	});
});
