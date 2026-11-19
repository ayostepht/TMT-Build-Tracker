import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, runMigrations } from '#lib/server/db/index.ts';
import { member, organization, templates, user } from '#lib/server/db/schema.ts';
import { templateSeeds } from '#lib/server/seed/index.ts';
import { seedTemplates } from '#lib/server/seed/run.ts';
import { createBuild } from '#lib/server/builds/create.ts';
import { setOrgSettings } from '#lib/server/org-settings.ts';
import { startMockSpoolman, type MockSpoolman } from '#lib/server/spoolman/mock-spoolman.ts';
import { GET as CREATE_FORM, POST as CREATE } from './create/+server.ts';
import { POST as STOCK_ADD } from './stock/+server.ts';
import { DELETE as STOCK_DEL } from './stock/[addId]/+server.ts';

// Create and stock routes: editors write (viewer 403, outsider 404, signed out 401).

let mock: MockSpoolman;
let buildId: string;
let role: string;

const ev = (
	as: string | null,
	params: Record<string, string>,
	body?: unknown,
	search = '',
	method?: string
) =>
	({
		request: new Request('http://x.test/api', {
			method: method ?? (body === undefined ? 'GET' : 'POST'),
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

describe('create and stock routes', () => {
	const p = () => ({ id: buildId, role });
	const form = {
		vendorName: 'Route Vendor',
		name: 'Route Teal',
		material: 'PETG',
		colorHex: '#12a0a0',
		density: 1.27,
		weightG: 1000
	};
	it('require a signed-in member; outsiders see 404; viewers 403', async () => {
		for (const [as, want] of [
			[null, 401],
			['out', 404],
			['viewer', 403]
		] as const) {
			expect(await code(CREATE_FORM(ev(as, p())))).toBe(want);
			expect(await code(CREATE(ev(as, p(), form)))).toBe(want);
			expect(await code(STOCK_ADD(ev(as, p(), { kg: 1 })))).toBe(want);
			expect(
				await code(STOCK_DEL(ev(as, { ...p(), addId: 'x' }, undefined, '?archive=1', 'DELETE')))
			).toBe(want);
		}
		expect(mock.calls.filter((c) => c.startsWith('POST') || c.startsWith('PATCH'))).toHaveLength(0);
	});
	it('editors create, add a spool, then remove it with an archive', async () => {
		const f = await (await CREATE_FORM(ev('editor', p()))).json();
		expect(f.defaults.diameter).toBe(1.75);
		const r = await CREATE(ev('editor', p(), form));
		expect(r.status).toBe(200);
		const made = await r.json();
		expect(made).toMatchObject({ linked: true, vendorCreated: true });
		expect(await code(CREATE(ev('editor', p(), { ...form, density: 0 })))).toBe(400);
		const a = await STOCK_ADD(ev('editor', p(), { kg: 1, note: 'x' }));
		expect(a.status).toBe(200);
		const added = await a.json();
		expect(await code(STOCK_ADD(ev('editor', p(), { kg: 0 })))).toBe(400);
		const d = await STOCK_DEL(
			ev('editor', { ...p(), addId: added.id }, undefined, '?archive=1', 'DELETE')
		);
		expect(d.status).toBe(200);
		expect(await d.json()).toMatchObject({ archived: true });
		expect(mock.spools.get(added.spoolmanSpoolId)!.archived).toBe(true);
		expect(
			await code(STOCK_DEL(ev('editor', { ...p(), addId: added.id }, undefined, '', 'DELETE')))
		).toBe(404);
	});
	it('a response never carries the Spoolman address', async () => {
		const text = await (await CREATE_FORM(ev('editor', p()))).text();
		expect(text).not.toContain(mock.url);
	});
});
