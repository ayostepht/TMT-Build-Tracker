import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { describeActivity } from '#lib/domain/activity.ts';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildFilaments,
	builds,
	colorDesigns,
	member,
	organization,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { createBuild } from '../builds/create';
import { loadBuildView } from '../builds/view';
import { onBuildEvents } from '../builds/test-helpers';
import {
	createDesign,
	deleteDesign,
	findDesign,
	getDesignDetail,
	listDesigns,
	saveSnapshot,
	updateDesignMeta
} from './designs';
import { applyDesignToBuild, updateBuildDesign } from './mutate';

let db: Db;
let templateId: string;
const orgId = 'org1';

function addUser(id: string) {
	db.insert(user)
		.values({ id, name: `User ${id}`, email: `${id}@example.test`, createdAt: new Date() })
		.run();
}
function addMember(org: string, u: string, role: string) {
	db.insert(member)
		.values({ id: `m-${org}-${u}`, organizationId: org, userId: u, role, createdAt: new Date() })
		.run();
}

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	for (const [id, slug] of [
		[orgId, 'chapter'],
		['org2', 'other']
	])
		db.insert(organization).values({ id, name: slug, slug, createdAt: new Date() }).run();
	for (const [u, role] of [
		['owner', 'owner'],
		['editor', 'editor'],
		['viewer', 'viewer']
	]) {
		addUser(u);
		addMember(orgId, u, role);
	}
	addUser('outsider');
	addMember('org2', 'outsider', 'owner');
});

const mk = (designId: string | null = null, org = orgId, u = 'owner') =>
	createBuild(db, { organizationId: org, templateId, designId, name: 'B' }, u);
const view = (id: string, u = 'owner') => loadBuildView(db, id, u)!;
const last = (v: ReturnType<typeof view>, kind: string) => v.activity.find((a) => a.kind === kind)!;
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		if (e instanceof ApiError) return e.status;
		throw e;
	}
	return 0;
};

describe('updateBuildDesign', () => {
	it('lets an editor move parts, persists, logs and emits', () => {
		const id = mk();
		const ev = onBuildEvents(id);
		const before = view(id, 'editor');
		const accent = before.filaments.find((f) => f.key === 'accent')!;
		expect(before.allParts.find((p) => p.slug === 'wing-left')!.role).not.toBe('primary');
		updateBuildDesign(db, id, 'editor', {
			partRoles: { 'wing-left': 'primary', 'wing-right': 'primary' }
		});
		const after = view(id, 'editor');
		expect(after.allParts.find((p) => p.slug === 'wing-left')!.role).toBe('primary');
		expect(after.allParts.find((p) => p.slug === 'wing-right')!.role).toBe('primary');
		const row = db.select().from(activity).where(eq(activity.buildId, id)).all().at(-1)!;
		expect(row.kind).toBe('design.update');
		expect(ev.some((e) => e.kind === 'design.update')).toBe(true);
		expect(describeActivity(last(after, 'design.update'), after)).toBe(
			'User editor moved Wing Left and Wing Right to ' +
				before.filaments.find((f) => f.key === 'primary')!.name
		);
		expect(accent.key).toBe('accent');
	});

	it('refuses viewers, outsiders, unknown parts and roles, and the wrong material', () => {
		const id = mk();
		const body = { partRoles: { 'wing-left': 'primary' } };
		expect(code(() => updateBuildDesign(db, id, 'viewer', body))).toBe(403);
		expect(code(() => updateBuildDesign(db, id, 'outsider', body))).toBe(404);
		expect(code(() => updateBuildDesign(db, id, 'owner', { partRoles: { nope: 'primary' } }))).toBe(
			400
		);
		expect(
			code(() => updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': 'ghost' } }))
		).toBe(400);
		// wing-left is PETG-only, "soft" is TPU
		expect(
			code(() => updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': 'soft' } }))
		).toBe(400);
		expect(code(() => updateBuildDesign(db, id, 'owner', {}))).toBe(400);
		// no-op move
		const cur = view(id).allParts.find((p) => p.slug === 'wing-left')!.role;
		expect(
			code(() => updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': cur } }))
		).toBe(400);
	});

	it('adds a color, uses it, and refuses to remove it while used (409)', () => {
		const id = mk();
		updateBuildDesign(db, id, 'owner', {
			addRole: { name: 'Polymaker Red', material: 'PETG', hex: '#C0281E' }
		});
		let v = view(id);
		const red = v.filaments.at(-1)!;
		expect(red).toMatchObject({ key: 'polymaker-red', hex: '#c0281e', spools: 0, tpu: false });
		expect(describeActivity(last(v, 'design.update'), v)).toBe(
			'User owner added a color: Polymaker Red'
		);
		updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': red.key } });
		v = view(id);
		expect(v.parts.find((p) => p.slug === 'wing-left')!.role).toBe('polymaker-red');
		expect(code(() => updateBuildDesign(db, id, 'owner', { removeRole: 'polymaker-red' }))).toBe(
			409
		);
		const original = view(id).filaments.find((f) => f.key === 'accent')!.key;
		updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': original } });
		updateBuildDesign(db, id, 'owner', { removeRole: 'polymaker-red' });
		expect(view(id).filaments.some((f) => f.key === 'polymaker-red')).toBe(false);
		expect(code(() => updateBuildDesign(db, id, 'owner', { removeRole: 'primary' }))).toBe(400);
		expect(code(() => updateBuildDesign(db, id, 'owner', { removeRole: 'zzz' }))).toBe(404);
	});

	it('adds a color and moves a part to it in one call; TPU colors only take TPU parts', () => {
		const id = mk();
		updateBuildDesign(db, id, 'owner', {
			addRole: { key: 'flex', name: 'Flex Pink', material: 'TPU 95A', hex: '#ff66aa' },
			partRoles: { 'soft-headrest': 'flex' }
		});
		const v = view(id);
		expect(v.filaments.find((f) => f.key === 'flex')!.tpu).toBe(true);
		expect(v.allParts.find((p) => p.slug === 'soft-headrest')!.role).toBe('flex');
		expect(
			code(() => updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': 'flex' } }))
		).toBe(400);
		expect(
			code(() =>
				updateBuildDesign(db, id, 'owner', {
					addRole: { key: 'flex', name: 'x', material: 'PLA', hex: '#000000' }
				})
			)
		).toBe(409);
	});
});

describe('designs', () => {
	it('saves a build as a design with full roles, and builds from it', () => {
		const id = mk();
		updateBuildDesign(db, id, 'owner', {
			addRole: { key: 'red', name: 'Red', material: 'PETG', hex: '#aa0000' },
			partRoles: { 'wing-left': 'red', 'wing-right': 'red' }
		});
		const made = createDesign(db, 'owner', { buildId: id, name: 'My Reds!', isPublic: true });
		expect(made.slug).toBe('my-reds');
		const d = findDesign(db, made.slug, 'outsider');
		expect(d.roles.map((r) => r.key)).toContain('red');
		expect(d.partRoles['wing-left']).toBe('red');
		expect(Object.keys(d.partRoles).length).toBe(view(id).allParts.length);

		const b2 = mk(d.id, 'org2', 'outsider');
		const v2 = view(b2, 'outsider');
		expect(v2.filaments.find((f) => f.key === 'red')).toMatchObject({
			name: 'Red',
			hex: '#aa0000'
		});
		expect(v2.parts.find((p) => p.slug === 'wing-right')!.role).toBe('red');
	});

	it('only editors can save; names are required; slugs stay unique', () => {
		const id = mk();
		expect(code(() => createDesign(db, 'viewer', { buildId: id, name: 'x' }))).toBe(403);
		expect(code(() => createDesign(db, 'outsider', { buildId: id, name: 'x' }))).toBe(404);
		expect(code(() => createDesign(db, 'owner', { buildId: id, name: '  ' }))).toBe(400);
		const a = createDesign(db, 'owner', { buildId: id, name: 'Same' });
		const b = createDesign(db, 'owner', { buildId: id, name: 'Same' });
		expect(a.slug).not.toBe(b.slug);
	});

	it('visibility: public, author, and people who share a workspace with the author', async () => {
		const id = mk();
		const priv = createDesign(db, 'owner', { buildId: id, name: 'Private one' });
		const pub = createDesign(db, 'owner', { buildId: id, name: 'Public one', isPublic: true });
		const names = async (u: string) => (await listDesigns(db, u)).map((d) => d.name);
		expect(await names('owner')).toEqual(expect.arrayContaining(['Private one', 'Public one']));
		// editor shares the chapter with the author
		expect(await names('editor')).toEqual(expect.arrayContaining(['Private one', 'Public one']));
		const out = await names('outsider');
		expect(out).toContain('Public one');
		expect(out).not.toContain('Private one');
		expect(code(() => findDesign(db, priv.id, 'outsider'))).toBe(404);
		expect(code(() => findDesign(db, pub.slug, 'outsider'))).toBe(0);
		// seeded design is public and has no author
		expect(out).toContain('Columbus #4691 Blues');
		const detail = await getDesignDetail(db, pub.slug, 'outsider');
		expect(detail.parts.length).toBe(view(id).allParts.length);
		expect(detail.authorName).toBe('User owner');
		expect(Object.values(detail.partCounts).reduce((a, b) => a + b, 0)).toBe(detail.parts.length);
	});

	it('only the author edits, unpublishes or deletes', async () => {
		const id = mk();
		const d = createDesign(db, 'owner', { buildId: id, name: 'Mine', isPublic: true });
		expect(code(() => updateDesignMeta(db, d.id, 'editor', { isPublic: false }))).toBe(403);
		updateDesignMeta(db, d.id, 'owner', { name: 'Renamed', isPublic: false });
		expect(db.select().from(colorDesigns).where(eq(colorDesigns.id, d.id)).get()).toMatchObject({
			name: 'Renamed',
			isPublic: false
		});
		expect(
			await deleteDesign(db, d.id, 'editor').then(
				() => 0,
				(e: ApiError) => e.status
			)
		).toBe(403);
		await deleteDesign(db, d.id, 'owner');
		expect(code(() => findDesign(db, d.id, 'owner'))).toBe(404);
		// a build made from it keeps its snapshot
		expect(view(id).allParts.length).toBeGreaterThan(0);
	});

	it('accepts only PNG previews from the author', async () => {
		const id = mk();
		const d = createDesign(db, 'owner', { buildId: id, name: 'Pic' });
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
		const run = (u: string, bytes: Uint8Array) =>
			saveSnapshot(db, d.id, u, bytes).then(
				() => 0,
				(e: ApiError) => e.status
			);
		expect(await run('owner', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(400);
		expect(await run('owner', new Uint8Array(3 * 1024 * 1024))).toBe(413);
		expect(await run('editor', png)).toBe(403);
		expect(await run('owner', png)).toBe(0);
		expect((await listDesigns(db, 'owner')).find((x) => x.id === d.id)!.hasSnapshot).toBe(true);
		await deleteDesign(db, d.id, 'owner');
	});
});

describe('applyDesignToBuild', () => {
	it('replaces roles and parts, keeps spools, logs design.apply', () => {
		const src = mk();
		updateBuildDesign(db, src, 'owner', {
			addRole: { key: 'red', name: 'Red', material: 'PETG', hex: '#aa0000' },
			partRoles: { 'wing-left': 'red' }
		});
		db.update(buildFilaments)
			.set({ name: 'Custom Primary', hex: '#123456' })
			.where(and(eq(buildFilaments.buildId, src), eq(buildFilaments.roleKey, 'primary')))
			.run();
		const d = createDesign(db, 'owner', { buildId: src, name: 'Source', isPublic: true });

		const target = mk();
		db.update(buildFilaments).set({ spools: 7 }).where(eq(buildFilaments.buildId, target)).run();
		expect(code(() => applyDesignToBuild(db, d.id, target, 'viewer'))).toBe(403);
		expect(code(() => applyDesignToBuild(db, d.id, target, 'outsider'))).toBe(404);
		const ev = onBuildEvents(target);
		applyDesignToBuild(db, d.id, target, 'editor');
		const v = view(target);
		expect(v.filaments.find((f) => f.key === 'primary')).toMatchObject({
			name: 'Custom Primary',
			hex: '#123456',
			spools: 7
		});
		expect(v.filaments.find((f) => f.key === 'red')).toMatchObject({ hex: '#aa0000', spools: 0 });
		expect(v.parts.find((p) => p.slug === 'wing-left')!.role).toBe('red');
		expect(describeActivity(last(v, 'design.apply'), v)).toBe(
			'User editor applied the color design "Source"'
		);
		expect(ev.some((e) => e.kind === 'design.apply')).toBe(true);
		expect(
			(db.select().from(builds).where(eq(builds.id, target)).get()!.design as { id: string }).id
		).toBe(d.id);
	});

	it('refuses a design the user cannot see', () => {
		const src = mk();
		const d = createDesign(db, 'owner', { buildId: src, name: 'Hidden' });
		const other = mk(null, 'org2', 'outsider');
		expect(code(() => applyDesignToBuild(db, d.id, other, 'outsider'))).toBe(404);
	});
});
