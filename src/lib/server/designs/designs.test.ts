import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { describeActivity } from '#lib/domain/activity.ts';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildFilaments,
	buildPlates,
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

	it('adds a color and removes it once nothing uses it', () => {
		const id = mk();
		updateBuildDesign(db, id, 'owner', {
			addRole: { name: 'Polymaker Red', material: 'PETG', hex: '#C0281E' }
		});
		let v = view(id);
		const red = v.filaments.at(-1)!;
		expect(red).toMatchObject({
			key: 'polymaker-red',
			hex: '#c0281e',
			spools: 0,
			tpu: false,
			kit: false
		});
		expect(describeActivity(last(v, 'design.update'), v)).toBe(
			'User owner added a color: Polymaker Red'
		);
		updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': red.key } });
		v = view(id);
		expect(v.parts.find((p) => p.slug === 'wing-left')!.role).toBe('polymaker-red');
		updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': 'accent' } });
		updateBuildDesign(db, id, 'owner', { removeRole: 'polymaker-red' });
		expect(view(id).filaments.some((f) => f.key === 'polymaker-red')).toBe(false);
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

const addRed = (id: string, extra: Record<string, unknown> = {}) =>
	updateBuildDesign(db, id, 'owner', {
		addRole: { key: 'red', name: 'Red', material: 'PETG', hex: '#aa0000' },
		...extra
	});
const lockedOf = (id: string) =>
	view(id)
		.allParts.filter((p) => p.locked)
		.map((p) => p.slug)
		.sort();
const rolesOfBuild = (id: string) =>
	Object.fromEntries(view(id).allParts.map((p) => [p.slug, p.role]));
const activityCount = (id: string) =>
	db.select().from(activity).where(eq(activity.buildId, id)).all().length;

describe('removing a color that is in use', () => {
	it('needs a replacement: 409 without one, 400 for the kit, an unknown slot or itself', () => {
		const id = mk();
		addRed(id, { partRoles: { 'wing-left': 'red' } });
		expect(code(() => updateBuildDesign(db, id, 'owner', { removeRole: 'red' }))).toBe(409);
		expect(
			code(() => updateBuildDesign(db, id, 'owner', { removeRole: 'red', replaceWith: 'red' }))
		).toBe(400);
		expect(
			code(() => updateBuildDesign(db, id, 'owner', { removeRole: 'red', replaceWith: 'nope' }))
		).toBe(400);
		expect(
			code(() => updateBuildDesign(db, id, 'owner', { removeRole: 'primary', replaceWith: 'red' }))
		).toBe(400);
		expect(code(() => updateBuildDesign(db, id, 'owner', { replaceWith: 'primary' }))).toBe(400);
		expect(view(id).filaments.some((f) => f.key === 'red')).toBe(true);
	});

	it('names the parts a replacement cannot take (material) and changes nothing', () => {
		const id = mk();
		updateBuildDesign(db, id, 'owner', {
			addRole: { key: 'flex', name: 'Flex Pink', material: 'TPU 95A', hex: '#ff66aa' },
			partRoles: { 'soft-headrest': 'flex' }
		});
		const n = activityCount(id);
		let msg = '';
		try {
			updateBuildDesign(db, id, 'owner', { removeRole: 'flex', replaceWith: 'primary' });
		} catch (e) {
			expect(e).toBeInstanceOf(ApiError);
			expect((e as ApiError).status).toBe(400);
			msg = (e as ApiError).message;
		}
		expect(msg).toMatch(/Soft Headrest/);
		expect(rolesOfBuild(id)['soft-headrest']).toBe('flex');
		expect(activityCount(id)).toBe(n);
		updateBuildDesign(db, id, 'owner', { removeRole: 'flex', replaceWith: 'soft' });
		expect(rolesOfBuild(id)['soft-headrest']).toBe('soft');
	});

	it('moves every part (hidden variants too, locks kept), drops spools and link, remaps grams, logs it', () => {
		const id = mk();
		addRed(id, { partRoles: { 'wing-left': 'red', 'footrest-front': 'red' } });
		updateBuildDesign(db, id, 'owner', { lock: { slugs: ['wing-left'], locked: true } });
		db.update(buildFilaments)
			.set({ spools: 2, spoolmanSpoolId: 7 })
			.where(and(eq(buildFilaments.buildId, id), eq(buildFilaments.roleKey, 'red')))
			.run();
		db.insert(buildPlates)
			.values({ buildId: id, number: 90, name: 'P', filamentGrams: { red: 10, primary: 5 } })
			.run();
		expect(view(id).parts.some((p) => p.slug === 'footrest-front')).toBe(false);
		const ev = onBuildEvents(id);
		const n = activityCount(id);
		updateBuildDesign(db, id, 'editor', { removeRole: 'red', replaceWith: 'primary' });
		const v = view(id);
		expect(v.filaments.some((f) => f.key === 'red')).toBe(false);
		expect(
			db
				.select()
				.from(buildFilaments)
				.where(and(eq(buildFilaments.buildId, id), eq(buildFilaments.roleKey, 'red')))
				.all()
		).toEqual([]);
		expect(rolesOfBuild(id)).toMatchObject({ 'wing-left': 'primary', 'footrest-front': 'primary' });
		expect(lockedOf(id)).toEqual(['wing-left']);
		expect(
			db
				.select()
				.from(buildPlates)
				.where(and(eq(buildPlates.buildId, id), eq(buildPlates.number, 90)))
				.get()!.filamentGrams
		).toEqual({ primary: 15 });
		expect(activityCount(id)).toBe(n + 1);
		expect(ev.at(-1)!.kind).toBe('design.update');
		const text = describeActivity(last(v, 'design.update'), v);
		expect(text).toContain(
			'removed Red PETG; its 2 parts now use Primary PETG and unlinked Spoolman spool #7 and dropped 2 spools of stock'
		);
		expect(text).toContain('unlinked Spoolman spool #7');
		expect(text).toContain('dropped 2 spools of stock');
	});

	it('works on a Studio draft and not for viewers', () => {
		const id = createBuild(
			db,
			{ organizationId: orgId, templateId, designId: null, name: 'D', kind: 'draft' },
			'owner'
		);
		addRed(id, { partRoles: { 'wing-left': 'red' } });
		expect(
			code(() => updateBuildDesign(db, id, 'viewer', { removeRole: 'red', replaceWith: 'primary' }))
		).toBe(403);
		updateBuildDesign(db, id, 'editor', { removeRole: 'red', replaceWith: 'accent' });
		expect(rolesOfBuild(id)['wing-left']).toBe('accent');
		expect(view(id).filaments.some((f) => f.key === 'red')).toBe(false);
	});
});

describe('Lock part color', () => {
	it('locks and unlocks parts, logs part names, and ignores a repeat', () => {
		const id = mk();
		updateBuildDesign(db, id, 'editor', {
			lock: { slugs: ['wing-left', 'wing-right'], locked: true }
		});
		expect(lockedOf(id)).toEqual(['wing-left', 'wing-right']);
		let v = view(id);
		expect(describeActivity(last(v, 'design.update'), v)).toBe(
			'User editor locked the part color of Wing Left and Wing Right'
		);
		const n = activityCount(id);
		updateBuildDesign(db, id, 'editor', { lock: { slugs: ['wing-left'], locked: true } });
		expect(activityCount(id)).toBe(n);
		updateBuildDesign(db, id, 'editor', { lock: { slugs: ['wing-left'], locked: false } });
		expect(lockedOf(id)).toEqual(['wing-right']);
		v = view(id);
		expect(describeActivity(last(v, 'design.update'), v)).toBe(
			'User editor unlocked the part color of Wing Left'
		);
		// the roles and filaments survive a lock write
		expect(v.filaments).toHaveLength(4);
		expect(
			code(() => updateBuildDesign(db, id, 'viewer', { lock: { slugs: ['x'], locked: true } }))
		).toBe(403);
		expect(
			code(() => updateBuildDesign(db, id, 'owner', { lock: { slugs: ['nope'], locked: true } }))
		).toBe(400);
		expect(
			code(() => updateBuildDesign(db, id, 'owner', { lock: { slugs: [], locked: true } }))
		).toBe(400);
		expect(code(() => updateBuildDesign(db, id, 'owner', { lock: { slugs: ['wing-left'] } }))).toBe(
			400
		);
	});

	it('locks only the listed part, never its symmetry peer, and a palette adds at most one slot', () => {
		const id = mk();
		// Wing Left and Wing Right share a symmetry group but sit on different slots.
		updateBuildDesign(db, id, 'owner', {
			partRoles: { 'wing-left': 'primary', 'wing-right': 'accent' }
		});
		updateBuildDesign(db, id, 'owner', { lock: { slugs: ['wing-left'], locked: true } });
		expect(lockedOf(id)).toEqual(['wing-left']);
		const v = view(id);
		expect(describeActivity(last(v, 'design.update'), v)).toBe(
			'User owner locked the part color of Wing Left'
		);
		updateBuildDesign(db, id, 'owner', {
			palette: {
				label: 'Sunset',
				reset: true,
				slots: {
					primary: { name: 'Sun Orange', material: 'PETG', hex: '#ff8800' },
					accent: { name: 'Sun Red', material: 'PETG', hex: '#cc2200' }
				}
			}
		});
		expect(view(id).filaments).toHaveLength(5);
		expect(lockedOf(id)).toEqual(['wing-left']);
		expect(rolesOfBuild(id)['wing-right']).toBe('accent');
		updateBuildDesign(db, id, 'owner', { lock: { slugs: ['wing-left'], locked: false } });
		expect(lockedOf(id)).toEqual([]);
	});

	it('a locked part can still be moved by hand', () => {
		const id = mk();
		updateBuildDesign(db, id, 'owner', { lock: { slugs: ['wing-left'], locked: true } });
		updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': 'primary' } });
		expect(rolesOfBuild(id)['wing-left']).toBe('primary');
		expect(lockedOf(id)).toEqual(['wing-left']);
	});

	it('Apply this design clears the locks', () => {
		const id = mk();
		const d = createDesign(db, 'owner', { buildId: id, name: 'Same' });
		updateBuildDesign(db, id, 'owner', {
			lock: { slugs: ['wing-left', 'seat-center'], locked: true }
		});
		applyDesignToBuild(db, d.id, id, 'owner');
		expect(lockedOf(id)).toEqual([]);
		expect(
			(db.select().from(builds).where(eq(builds.id, id)).get()!.design as Record<string, unknown>)
				.lockedParts
		).toBeUndefined();
	});
});

describe('applying a palette in one call', () => {
	const pal = (reset = true) => ({
		palette: {
			label: 'Sunset',
			reset,
			slots: {
				primary: { name: 'Sun Orange', material: 'PETG', hex: '#ff8800' },
				accent: { name: 'Sun Red', material: 'PETG', hex: '#cc2200' }
			}
		}
	});

	it('sets the filaments and sends every unlocked part back to its kit slot, as one activity row', () => {
		const id = mk();
		updateBuildDesign(db, id, 'owner', {
			addRole: { key: 'red', name: 'Red', material: 'PETG', hex: '#aa0000' },
			partRoles: { 'wing-left': 'red', 'seat-center': 'accent', 'push-top': 'primary' }
		});
		const ev = onBuildEvents(id);
		const n = activityCount(id);
		updateBuildDesign(db, id, 'editor', pal());
		const v = view(id);
		expect(activityCount(id)).toBe(n + 1);
		expect(ev).toHaveLength(1);
		expect(db.select().from(activity).where(eq(activity.buildId, id)).all().at(-1)!.kind).toBe(
			'design.update'
		);
		expect(v.filaments.find((f) => f.key === 'primary')).toMatchObject({
			name: 'Sun Orange',
			hex: '#ff8800'
		});
		expect(v.allParts.every((p) => p.role === p.defaultRole)).toBe(true);
		const text = describeActivity(last(v, 'design.update'), v);
		expect(text).toContain('applied the Sunset palette; 3 parts back to their kit colors');
	});

	it('keeps locked parts on their exact color by moving them to a slot that holds it', () => {
		const id = mk();
		const before = view(id);
		const oldPrimary = before.filaments.find((f) => f.key === 'primary')!;
		const oldAccent = before.filaments.find((f) => f.key === 'accent')!;
		updateBuildDesign(db, id, 'owner', {
			partRoles: { 'wing-right': 'primary' },
			lock: { slugs: ['wing-left', 'seat-center', 'wing-right'], locked: true }
		});
		updateBuildDesign(db, id, 'owner', pal());
		const v = view(id);
		const roles = rolesOfBuild(id);
		// wing-left was on accent, seat-center on primary, wing-right (locked) on primary: all keep the old color
		const slotOf = (slug: string) => v.filaments.find((f) => f.key === roles[slug])!;
		expect(slotOf('wing-left')).toMatchObject({
			name: oldAccent.name,
			hex: oldAccent.hex,
			kit: false
		});
		expect(slotOf('seat-center')).toMatchObject({
			name: oldPrimary.name,
			hex: oldPrimary.hex,
			kit: false
		});
		expect(roles['wing-right']).toBe(roles['seat-center']);
		expect(v.filaments).toHaveLength(6);
		expect(lockedOf(id)).toEqual(['seat-center', 'wing-left', 'wing-right']);
		const text = describeActivity(last(v, 'design.update'), v);
		expect(text).toContain('3 locked parts kept');
		expect(text).toContain('on a new color slot');
		// the same palette again changes nothing about the locked parts and adds no slot
		updateBuildDesign(db, id, 'owner', {
			palette: {
				label: 'Again',
				reset: true,
				slots: { primary: { name: 'Other', material: 'PETG', hex: '#010203' } }
			}
		});
		expect(view(id).filaments).toHaveLength(6);
		expect(rolesOfBuild(id)['seat-center']).toBe(roles['seat-center']);
	});

	it('reuses an existing non-kit slot that already holds the locked color', () => {
		const id = mk();
		const primary = view(id).filaments.find((f) => f.key === 'primary')!;
		updateBuildDesign(db, id, 'owner', {
			addRole: { key: 'same', name: primary.name, material: primary.material, hex: primary.hex },
			lock: { slugs: ['seat-center'], locked: true }
		});
		updateBuildDesign(db, id, 'owner', pal());
		expect(rolesOfBuild(id)['seat-center']).toBe('same');
		expect(
			view(id)
				.filaments.map((f) => f.key)
				.sort()
		).toEqual(['accent', 'primary', 'same', 'soft', 'tire']);
		const v = view(id);
		expect(describeActivity(last(v, 'design.update'), v)).not.toContain('new color slot');
	});

	it('leaves a locked part alone when its slot keeps the same filament', () => {
		const id = mk();
		const primary = view(id).filaments.find((f) => f.key === 'primary')!;
		updateBuildDesign(db, id, 'owner', { lock: { slugs: ['seat-center'], locked: true } });
		updateBuildDesign(db, id, 'owner', {
			palette: {
				label: 'Same',
				reset: true,
				slots: { primary: { name: primary.name, material: primary.material, hex: primary.hex } }
			}
		});
		expect(rolesOfBuild(id)['seat-center']).toBe('primary');
		expect(view(id).filaments).toHaveLength(4);
	});

	it('Undo: one call restores filaments, part colors and removes the auto-added slots', () => {
		const id = mk();
		updateBuildDesign(db, id, 'owner', {
			partRoles: { 'wing-right': 'primary' },
			lock: { slugs: ['wing-left'], locked: true }
		});
		const before = view(id);
		const slots = Object.fromEntries(
			before.filaments
				.filter((f) => f.kit)
				.map((f) => [f.key, { name: f.name, material: f.material, hex: f.hex }])
		);
		const beforeRoles = rolesOfBuild(id);
		const keys = new Set(before.filaments.map((f) => f.key));
		updateBuildDesign(db, id, 'owner', pal());
		const added = view(id)
			.filaments.map((f) => f.key)
			.filter((k) => !keys.has(k));
		expect(added).toHaveLength(1);
		const n = activityCount(id);
		updateBuildDesign(db, id, 'owner', {
			palette: { label: 'earlier', slots },
			partRoles: beforeRoles,
			removeRoles: added
		});
		expect(activityCount(id)).toBe(n + 1);
		const after = view(id);
		expect(rolesOfBuild(id)).toEqual(beforeRoles);
		const shape = (v: typeof after) =>
			v.filaments.map((f) => [f.key, f.name, f.material, f.hex.toLowerCase()]).sort();
		expect(shape(after)).toEqual(shape(before));
		expect(lockedOf(id)).toEqual(['wing-left']);
		// removeRoles only takes slots nothing uses
		expect(code(() => updateBuildDesign(db, id, 'owner', { removeRoles: ['primary'] }))).toBe(409);
	});

	it('works on drafts, is refused for viewers, and validates the body', () => {
		const id = createBuild(
			db,
			{ organizationId: orgId, templateId, designId: null, name: 'D', kind: 'draft' },
			'owner'
		);
		expect(code(() => updateBuildDesign(db, id, 'viewer', pal()))).toBe(403);
		expect(code(() => updateBuildDesign(db, id, 'owner', { palette: { slots: {} } }))).toBe(400);
		expect(
			code(() =>
				updateBuildDesign(db, id, 'owner', {
					palette: { label: 'x', slots: { ghost: { name: 'a', material: 'PETG', hex: '#000000' } } }
				})
			)
		).toBe(400);
		expect(
			code(() =>
				updateBuildDesign(db, id, 'owner', {
					palette: { label: 'x', slots: { primary: { name: 'a', material: 'PETG', hex: 'red' } } }
				})
			)
		).toBe(400);
		updateBuildDesign(db, id, 'editor', pal());
		expect(view(id).filaments.find((f) => f.key === 'accent')!.hex).toBe('#cc2200');
	});
});
