import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { isCustomPlate } from '#lib/domain/custom.ts';
import { ApiError } from './access';
import { openDb, runMigrations, type Db } from './db';
import {
	buildUploads,
	member,
	organization,
	templateFilamentRoles,
	templateParts,
	templates,
	user,
	workspaceCustomPieces
} from './db/schema';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';
import { makeProjectThreeMf } from './threemf/fixtures';
import { createBuild } from './builds/create';
import { loadBuildView } from './builds/view';
import { MAX_CUSTOM_PLATES } from '#lib/domain/custom.ts';
import {
	MAX_LIBRARY_PIECES,
	applyLibraryPiece,
	createLibraryPiece,
	libraryTemplateOptions
} from './custom-library';

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('#lib/server/db/index.ts', async (orig) => ({
	...(await orig<object>()),
	getDb: () => h.db
}));

let db: Db;
let dir: string;
let templateId: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'tmt-lib-create-'));
	vi.stubEnv('DATABASE_URL', join(dir, 'tmt.db'));
	db = openDb(':memory:');
	h.db = db;
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	for (const o of ['org1', 'org2'])
		db.insert(organization)
			.values({ id: o, name: `Chapter ${o}`, slug: o, createdAt: new Date() })
			.run();
	for (const [u, o, role] of [
		['owner', 'org1', 'owner'],
		['viewer', 'org1', 'viewer'],
		['outsider', '', ''],
		['other', 'org2', 'owner']
	]) {
		db.insert(user)
			.values({ id: u, name: u, email: `${u}@example.test`, emailVerified: false })
			.run();
		if (role)
			db.insert(member)
				.values({ id: `m-${u}`, organizationId: o, userId: u, role, createdAt: new Date() })
				.run();
	}
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dir, { recursive: true, force: true });
});

const status = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		if (e instanceof ApiError) return e.status;
		throw e;
	}
	return 0;
};
const plate = (over: Record<string, unknown> = {}) => ({ role: 'primary', ...over });
const make = (over: Record<string, unknown> = {}, user = 'owner', org = 'org1') =>
	createLibraryPiece(db, user, org, { name: 'Cup holder', plates: [plate()], ...over });

describe('creating a saved part by hand', () => {
	it('stores what was given and returns the view', () => {
		const p = make({
			name: '  Cup   holder ',
			fileName: 'cup.3mf',
			isDefault: true,
			replaces: ['handle-left', 'handle-left'],
			plates: [
				plate({ name: 'Base', estSeconds: 5400, grams: 40, runs: 2, role: 'accent' }),
				plate({ estSeconds: null, filamentGrams: { primary: 3, soft: 1 } })
			]
		});
		expect(p).toMatchObject({
			name: 'Cup holder',
			fileName: 'cup.3mf',
			sliced: false,
			templateId,
			isDefault: true,
			replaces: ['handle-left'],
			totalSeconds: 10800,
			totalGrams: 80 + 4
		});
		expect(p.plates[0]).toMatchObject({
			index: 0,
			name: 'Base',
			estSeconds: 5400,
			grams: 40,
			role: 'accent',
			runs: 2
		});
		expect(p.plates[1]).toMatchObject({ index: 1, name: '', estSeconds: null, grams: 4, runs: 1 });
		const row = db
			.select()
			.from(workspaceCustomPieces)
			.where(eq(workspaceCustomPieces.id, p.id))
			.get()!;
		expect(row.organizationId).toBe('org1');
		expect(row.plates[0]).toMatchObject({ filamentGrams: {}, thumb: false });
		expect(row.plates[1].filamentGrams).toEqual({ primary: 3, soft: 1 });
	});

	it('scales per-color grams to the typed total', () => {
		const p = make({ plates: [plate({ grams: 8, filamentGrams: { primary: 3, soft: 1 } })] });
		const row = db
			.select()
			.from(workspaceCustomPieces)
			.where(eq(workspaceCustomPieces.id, p.id))
			.get()!;
		expect(row.plates[0].filamentGrams).toEqual({ primary: 6, soft: 2 });
		expect(row.plates[0].grams).toBe(8);
	});

	it('is refused for viewers (403), non-members (404) and other workspaces', () => {
		expect(status(() => make({}, 'viewer'))).toBe(403);
		expect(status(() => make({}, 'outsider'))).toBe(404);
		expect(status(() => make({}, 'other'))).toBe(404);
		expect(status(() => make({}, 'other', 'org2'))).toBe(0);
		expect(db.select().from(workspaceCustomPieces).all()).toHaveLength(1);
	});

	it('checks names, plates, roles, slugs, numbers and the caps', () => {
		const bad = (over: Record<string, unknown>) => status(() => make(over));
		expect(bad({ name: '  ' })).toBe(400);
		expect(bad({ name: 5 })).toBe(400);
		expect(bad({ plates: [] })).toBe(400);
		expect(bad({ plates: 'x' })).toBe(400);
		expect(bad({ plates: Array.from({ length: MAX_CUSTOM_PLATES + 1 }, () => plate()) })).toBe(400);
		expect(bad({ plates: [null] })).toBe(400);
		expect(bad({ plates: [{}] })).toBe(400);
		expect(bad({ plates: [plate({ role: 'nope' })] })).toBe(400);
		expect(bad({ plates: [plate({ role: '__proto__' })] })).toBe(400);
		expect(bad({ plates: [plate({ role: 'constructor' })] })).toBe(400);
		expect(bad({ plates: [plate({ runs: 0 })] })).toBe(400);
		expect(bad({ plates: [plate({ runs: 21 })] })).toBe(400);
		expect(bad({ plates: [plate({ runs: 1.5 })] })).toBe(400);
		expect(bad({ plates: [plate({ estSeconds: 0 })] })).toBe(400);
		expect(bad({ plates: [plate({ estSeconds: 2_592_001 })] })).toBe(400);
		expect(bad({ plates: [plate({ grams: 0 })] })).toBe(400);
		expect(bad({ plates: [plate({ grams: 20001 })] })).toBe(400);
		expect(bad({ plates: [plate({ grams: '5' })] })).toBe(400);
		expect(bad({ plates: [plate({ name: 5 })] })).toBe(400);
		expect(bad({ plates: [plate({ filamentGrams: { nope: 3 } })] })).toBe(400);
		expect(bad({ plates: [plate({ filamentGrams: JSON.parse('{"__proto__": 3}') })] })).toBe(400);
		expect(bad({ plates: [plate({ filamentGrams: { primary: 0 } })] })).toBe(400);
		expect(bad({ plates: [plate({ filamentGrams: [3] })] })).toBe(400);
		expect(bad({ replaces: ['no-such-part'] })).toBe(400);
		expect(bad({ replaces: ['__proto__'] })).toBe(400);
		expect(bad({ replaces: 'handle-left' })).toBe(400);
		expect(bad({ replaces: Array.from({ length: 61 }, () => 'handle-left') })).toBe(400);
		expect(bad({ sliced: 'yes' })).toBe(400);
		expect(bad({ isDefault: 1 })).toBe(400);
		expect(bad({ fileName: 5 })).toBe(400);
		expect(bad({ templateId: 5 })).toBe(400);
		expect(db.select().from(workspaceCustomPieces).all()).toEqual([]);
		// control characters and length are cleaned
		const p = make({
			name: `a${String.fromCharCode(0)}b${'x'.repeat(200)}`,
			plates: [plate({ name: 'y'.repeat(200) })]
		});
		expect(p.name.length).toBeLessThanOrEqual(80);
		expect(p.name).not.toContain(String.fromCharCode(0));
		expect(p.plates[0].name.length).toBeLessThanOrEqual(80);
	});

	it('stops at the workspace cap', () => {
		for (let i = 0; i < MAX_LIBRARY_PIECES; i++) make({ name: `P${i}` });
		expect(status(() => make())).toBe(400);
		expect(status(() => make({}, 'other', 'org2'))).toBe(0);
	});

	it("refuses another workspace's kit copy and takes the workspace's own", () => {
		const copy = (org: string, slug: string) => {
			const t = db
				.insert(templates)
				.values({ slug, name: slug, version: '1', ownerOrgId: org })
				.returning()
				.get();
			db.insert(templateFilamentRoles)
				.values({ templateId: t.id, key: 'mine', name: 'Mine', material: 'PETG', hex: '#fff' })
				.run();
			db.insert(templateParts)
				.values({
					templateId: t.id,
					slug: 'only-here',
					name: 'Only here',
					section: 'S',
					defaultRole: 'mine'
				})
				.run();
			return t.id;
		};
		const foreign = copy('org2', 'fork-org2');
		const own = copy('org1', 'fork-org1');
		expect(status(() => make({ templateId: foreign }))).toBe(404);
		expect(status(() => make({ templateId: 'missing' }))).toBe(404);
		const p = make({ templateId: own, replaces: ['only-here'], plates: [plate({ role: 'mine' })] });
		expect(p.templateId).toBe(own);
		// roles and slugs are the chosen kit's, not the default's
		expect(status(() => make({ templateId: own, plates: [plate({ role: 'primary' })] }))).toBe(400);
		expect(status(() => make({ templateId: own, replaces: ['handle-left'] }))).toBe(400);
	});

	it('applies to a build with the right plates, time, grams and role', () => {
		const p = make({
			name: 'Cup holder',
			replaces: ['handle-left'],
			plates: [
				plate({ name: 'Base', estSeconds: 5400, grams: 40, runs: 2, role: 'accent' }),
				plate({ name: 'Arm', estSeconds: 600, grams: 5 })
			]
		});
		const id = createBuild(
			db,
			{ organizationId: 'org1', templateId, designId: null, name: 'B' },
			'owner'
		);
		const r = applyLibraryPiece(db, id, 'owner', p.id)!;
		const v = loadBuildView(db, id, 'owner')!;
		const plates = v.plates.filter(isCustomPlate);
		expect(plates.map((x) => x.number)).toEqual(r.plates);
		expect(plates[0]).toMatchObject({
			name: 'Cup holder - Base',
			estSeconds: 5400,
			estSource: 'manual',
			slicerGrams: 40,
			gramsSource: 'user',
			runs: 2
		});
		expect(plates[1]).toMatchObject({ name: 'Cup holder - Arm', estSeconds: 600, slicerGrams: 5 });
		expect(v.parts.find((x) => x.slug === plates[0].parts[0])!.role).toBe('accent');
		expect(v.parts.find((x) => x.slug === plates[1].parts[0])!.role).toBe('primary');
		expect(r.skipped).toEqual(['handle-left']);
	});

	it('lists the default kit roles and parts for the form, to members only', () => {
		const o = libraryTemplateOptions(db, 'org1', 'viewer');
		expect(o.templateId).toBe(templateId);
		expect(o.roles.map((r) => r.key)).toEqual(
			expect.arrayContaining(['primary', 'accent', 'soft'])
		);
		expect(o.roles[0]).toHaveProperty('name');
		expect(o.parts.some((p) => p.slug === 'handle-left')).toBe(true);
		expect(status(() => libraryTemplateOptions(db, 'org1', 'outsider'))).toBe(404);
	});
});

describe('POST /api/custom-library/inspect', () => {
	const importsDir = () => join(dir, 'uploads', 'imports');
	const temp = () => (existsSync(importsDir()) ? readdirSync(importsDir()) : []);
	const call = async (
		body: unknown,
		o: { user?: string; org?: string | null; type?: string; name?: string } = {}
	) => {
		const { POST } = await import('../../routes/api/custom-library/inspect/+server');
		const u = o.user ?? 'owner';
		const qs = new URLSearchParams({ name: o.name ?? 'cup.3mf' });
		if (o.org !== null) qs.set('organizationId', o.org ?? 'org1');
		const request = new Request(`http://x/api/custom-library/inspect?${qs}`, {
			method: 'POST',
			body: body as BodyInit,
			headers: { 'content-type': o.type ?? 'application/octet-stream' },
			// @ts-expect-error node fetch option
			duplex: 'half'
		});
		return POST({
			request,
			url: new URL(request.url),
			locals: { user: { id: u, email: `${u}@example.test`, emailVerified: false } }
		} as never);
	};
	const sliced = () =>
		makeProjectThreeMf({
			sliced: true,
			filamentTypes: ['PETG', 'TPU'],
			plates: [
				{
					name: 'BAR',
					prediction: 7200,
					weight: 70,
					filaments: { 1: 30, 2: 40 },
					objects: [{ name: 'Bar' }]
				}
			]
		});

	it('answers a summary for a sliced file and keeps nothing', async () => {
		const res = await call(sliced());
		expect(res.status).toBe(200);
		const j = await res.json();
		expect(j).toMatchObject({ fileName: 'cup.3mf', sliced: true });
		expect(j.plates).toHaveLength(1);
		expect(j.plates[0]).toMatchObject({
			index: 1,
			name: 'BAR',
			estSeconds: 7200,
			grams: 70,
			filamentGrams: { '1': 30, '2': 40 }
		});
		expect(
			j.plates[0].filaments.map((f: { slot: string; material: string; grams: number }) => [
				f.slot,
				f.material,
				f.grams
			])
		).toEqual([
			['1', 'PETG', 30],
			['2', 'TPU', 40]
		]);
		expect(JSON.stringify(j)).not.toContain('thumbnail');
		expect(temp()).toEqual([]);
		expect(existsSync(join(dir, 'uploads', '3mf'))).toBe(false);
		expect(db.select().from(buildUploads).all()).toEqual([]);
	});

	it('reads a header-only project as unsliced without numbers', async () => {
		const res = await call(
			makeProjectThreeMf({
				headerOnlySliceInfo: true,
				plates: [{ name: 'CUP', objects: [{ name: 'Cup' }] }]
			})
		);
		const j = await res.json();
		expect(j.sliced).toBe(false);
		expect(j.plates[0]).toMatchObject({
			estSeconds: null,
			grams: null,
			filamentGrams: {},
			filaments: []
		});
		expect(temp()).toEqual([]);
	});

	it('refuses multipart with 415, a viewer with 403 and a stranger with 404, all before the body is read', async () => {
		let read = false;
		const spy = () =>
			new ReadableStream(
				{
					pull(c) {
						read = true;
						c.enqueue(new Uint8Array(10));
						c.close();
					}
				},
				{ highWaterMark: 0 }
			);
		expect((await call(spy(), { type: 'multipart/form-data; boundary=x' })).status).toBe(415);
		expect(read).toBe(false);
		expect((await call(spy(), { user: 'viewer' })).status).toBe(403);
		expect((await call(spy(), { user: 'outsider' })).status).toBe(404);
		expect((await call(spy(), { user: 'other' })).status).toBe(404);
		expect((await call(spy(), { org: null })).status).toBe(400);
		expect(read).toBe(false);
		expect(temp()).toEqual([]);
	});

	it('refuses an oversize file with 413 and a broken one with 422, leaving no temp file', async () => {
		vi.stubEnv('MAX_3MF_MB', '1');
		expect((await call(new Uint8Array(1048576 + 100))).status).toBe(413);
		expect(temp()).toEqual([]);
		const res = await call(new Uint8Array(500).fill(7));
		expect(res.status).toBe(422);
		expect(temp()).toEqual([]);
		expect((await call(new Uint8Array(0))).status).toBe(400);
		expect(temp()).toEqual([]);
		expect(db.select().from(buildUploads).all()).toEqual([]);
	});

	it('removes the temp file when the client aborts mid-stream', async () => {
		const aborted = new ReadableStream({
			start(c) {
				c.enqueue(new Uint8Array(1000));
			},
			pull() {
				throw new Error('connection reset');
			}
		});
		expect((await call(aborted)).status).toBeGreaterThanOrEqual(400);
		expect(temp()).toEqual([]);
	});
});
