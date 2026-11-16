import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, runMigrations } from '#lib/server/db/index.ts';
import { member, organization, templates, user } from '#lib/server/db/schema.ts';
import { templateSeeds } from '#lib/server/seed/index.ts';
import { seedTemplates } from '#lib/server/seed/run.ts';
import { createBuild } from '#lib/server/builds/create.ts';
import { getOrgSettings, setOrgSettings } from '#lib/server/org-settings.ts';
import { startMockSpoolman, type MockSpoolman } from '#lib/server/spoolman/mock-spoolman.ts';
import { GET as GET_BUILD_SPOOLMAN } from '../../../spoolman/+server.ts';
import { GET as GET_SETTINGS, PUT as PUT_SETTINGS } from '../../../../../spoolman/+server.ts';
import { GET, PUT } from './+server.ts';
import { PUT as PUT_SPOOL } from './spool/+server.ts';
import { DELETE as PRELINK_UNDO, POST as PRELINK } from './prelink/+server.ts';

// Every Spoolman route: who may call it (viewer reads, editor writes, owner settings, outsider 404).

let mock: MockSpoolman;
let buildId: string;
let role: string;

const ev = (as: string | null, params: Record<string, string>, body?: unknown, search = '') =>
	({
		request: new Request('http://x.test/api', {
			method: body === undefined ? 'GET' : 'PUT',
			body: body === undefined ? undefined : JSON.stringify(body),
			headers: { 'content-type': 'application/json' }
		}),
		locals: { user: as ? { id: as } : null },
		params,
		url: new URL(`http://x.test/api${search}`)
	}) as never;
const code = async (p: Promise<Response> | Response) => (await p).status;

beforeAll(async () => {
	mock = await startMockSpoolman();
	mock.addFilament({ name: 'Blue' });
	mock.addSpool({ filament_id: 1 });
	vi.stubEnv('DATABASE_URL', join(mkdtempSync(join(tmpdir(), 'tmt-spoolman-')), 'tmt.db'));
	const db = getDb();
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	db.insert(organization).values({ id: 'org1', name: 'C', slug: 'c', createdAt: new Date() }).run();
	for (const id of ['owner', 'editor', 'viewer', 'out']) {
		db.insert(user)
			.values({ id, name: id, email: `${id}@example.test` })
			.run();
		if (id !== 'out')
			db.insert(member)
				.values({
					id: `m-${id}`,
					organizationId: 'org1',
					userId: id,
					role: id,
					createdAt: new Date()
				})
				.run();
	}
	const templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	buildId = createBuild(
		db,
		{ organizationId: 'org1', templateId, designId: null, name: 'B' },
		'owner'
	);
	setOrgSettings(db, 'org1', { spoolmanUrl: mock.url, spoolmanKeptBy: 'app' });
	const v = (await import('#lib/server/builds/view.ts')).loadBuildView(db, buildId, 'owner')!;
	role = v.filaments[0].key;
});
afterAll(() => mock.close());

describe('slot routes', () => {
	const p = () => ({ id: buildId, role });
	it('require a signed-in member; outsiders see 404', async () => {
		for (const as of [null, 'out']) {
			const want = as ? 404 : 401;
			expect(await code(GET(ev(as, p())))).toBe(want);
			expect(await code(PUT(ev(as, p(), { filamentId: 1 })))).toBe(want);
			expect(await code(PUT_SPOOL(ev(as, p(), { spoolId: 1 })))).toBe(want);
			expect(await code(PRELINK(ev(as, p(), {})))).toBe(want);
			expect(await code(PRELINK_UNDO(ev(as, p(), {})))).toBe(want);
			expect(await code(GET_BUILD_SPOOLMAN(ev(as, { id: buildId })))).toBe(want);
		}
	});
	it('viewers read but cannot change', async () => {
		expect(await code(GET(ev('viewer', p())))).toBe(200);
		expect(await code(GET_BUILD_SPOOLMAN(ev('viewer', { id: buildId })))).toBe(200);
		expect(await code(PUT(ev('viewer', p(), { filamentId: 1 })))).toBe(403);
		expect(await code(PUT_SPOOL(ev('viewer', p(), { spoolId: 1 })))).toBe(403);
		expect(await code(PRELINK(ev('viewer', p(), {})))).toBe(403);
		expect(await code(PRELINK_UNDO(ev('viewer', p(), {})))).toBe(403);
	});
	it('editors link, choose the spool and see the result', async () => {
		const r = await PUT(ev('editor', p(), { filamentId: 1 }));
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({ linked: true, filamentId: 1, spoolId: 1 });
		expect(await code(PUT_SPOOL(ev('editor', p(), { spoolId: 1 })))).toBe(200);
		expect(await code(PUT(ev('editor', p(), { filamentId: 'x' })))).toBe(400);
		const s = await (await GET(ev('viewer', p()))).json();
		expect(s.suggestions[0].filament.id).toBe(1);
	});
	it('a response never carries the Spoolman address', async () => {
		const text = await (await GET(ev('viewer', p()))).text();
		expect(text).not.toContain(mock.url);
	});
});

describe('workspace setting', () => {
	it('members read it, only owners change it, kept-by is validated', async () => {
		expect(await code(GET_SETTINGS(ev('viewer', {}, undefined, '?org=org1')))).toBe(200);
		expect(await code(GET_SETTINGS(ev('out', {}, undefined, '?org=org1')))).toBe(404);
		const put = (as: string | null, b: unknown) =>
			PUT_SETTINGS(ev(as, {}, { organizationId: 'org1', ...(b as object) }));
		expect(await code(put('editor', { spoolmanKeptBy: 'other' }))).toBe(403);
		expect(await code(put('viewer', { spoolmanKeptBy: 'other' }))).toBe(403);
		expect(await code(put('out', { spoolmanKeptBy: 'other' }))).toBe(404);
		expect(await code(put('owner', { spoolmanKeptBy: 'sometimes' }))).toBe(400);
		expect(await code(put('owner', { spoolmanKeptBy: 'other' }))).toBe(200);
		expect(getOrgSettings(getDb(), 'org1')).toMatchObject({
			spoolmanKeptBy: 'other',
			spoolmanAutoDeduct: false
		});
		expect(await code(put('owner', { spoolmanKeptBy: 'app' }))).toBe(200);
		expect(getOrgSettings(getDb(), 'org1').spoolmanAutoDeduct).toBe(true);
	});
});
