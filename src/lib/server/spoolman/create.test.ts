import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { ApiError } from '../access';
import { addSpool } from '../builds/actions';
import { createBuild } from '../builds/create';
import { loadBuildView } from '../builds/view';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildFilaments,
	member,
	organization,
	spoolmanCache,
	templates,
	user
} from '../db/schema';
import { setOrgSettings } from '../org-settings';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { SpoolmanClient } from './client';
import { setFilamentLink } from './link';
import {
	addSpoolmanSpool,
	createAndLinkFilament,
	createFormFor,
	removeSpoolmanSpoolAdd
} from './create';
import { startMockSpoolman, type MockSpoolman } from './mock-spoolman';
import { withSpoolmanLock } from './lock';

let mock: MockSpoolman;
const factory = (u: string) => new SpoolmanClient(u, 2000);

beforeAll(async () => (mock = await startMockSpoolman()));
afterAll(() => mock.close());

let db: Db;
let buildId: string;
let role: string;

beforeEach(() => {
	mock.reset();
	// filament 1: three spools; the first is nearly empty
	mock.addFilament({
		name: 'Overture Blue',
		vendor: { id: 1, name: 'Overture' },
		color_hex: '2B3F9E'
	});
	mock.addFilament({
		name: 'Red',
		vendor: { id: 2, name: 'Other' },
		color_hex: 'CC0000',
		material: 'PLA'
	});
	mock.addSpool({ filament_id: 1, used_weight: 970 }); // 30 g left
	mock.addSpool({ filament_id: 1 }); // 1000 g
	mock.addSpool({ filament_id: 1, archived: true });
	mock.addSpool({ filament_id: 2 });

	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	db.insert(organization).values({ id: 'org1', name: 'C', slug: 'c', createdAt: new Date() }).run();
	for (const [id, r] of [
		['owner', 'owner'],
		['editor', 'editor'],
		['viewer', 'viewer']
	] as const) {
		db.insert(user)
			.values({ id, name: id, email: `${id}@example.test` })
			.run();
		db.insert(member)
			.values({ id: `m-${id}`, organizationId: 'org1', userId: id, role: r, createdAt: new Date() })
			.run();
	}
	db.insert(user).values({ id: 'out', name: 'Out', email: 'out@example.test' }).run();
	const templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	buildId = createBuild(
		db,
		{ organizationId: 'org1', templateId, designId: null, name: 'B' },
		'owner'
	);
	setOrgSettings(db, 'org1', { spoolmanUrl: mock.url, spoolmanKeptBy: 'app' });
	role = loadBuildView(db, buildId, 'owner')!.parts.find((p) => p.slug === 'handle-left')!.role;
});

const slot = () => db.select().from(buildFilaments).where(eq(buildFilaments.roleKey, role)).get()!;
const kinds = () => db.select({ k: activity.kind, p: activity.payload }).from(activity).all();
const status = async (p: Promise<unknown>) =>
	p.then(
		() => 0,
		(e: ApiError) => e.status
	);
const form = {
	vendorName: 'Fresh Vendor',
	name: 'Fresh Vendor Teal',
	material: 'PETG',
	colorHex: '#12a0a0',
	density: 1.27,
	weightG: 1000,
	spoolWeightG: 230,
	externalId: 'fv_teal'
};
const create = (user = 'editor', over: Record<string, unknown> = {}) =>
	createAndLinkFilament(db, buildId, user, role, { ...form, ...over }, factory);

describe('create vendor and filament, then link', () => {
	it('creates the vendor and filament, links the slot, writes activity and cache', async () => {
		const r = await create();
		expect(r).toMatchObject({ linked: true, vendorCreated: true, reused: false });
		const f = mock.filaments.get(r.filamentId!)!;
		expect(f).toMatchObject({
			name: 'Fresh Vendor Teal',
			material: 'PETG',
			color_hex: '12a0a0',
			density: 1.27,
			diameter: 1.75,
			weight: 1000,
			spool_weight: 230,
			external_id: 'fv_teal'
		});
		expect(f.vendor.name).toBe('Fresh Vendor');
		expect(slot().spoolmanFilamentId).toBe(f.id);
		expect(db.select().from(spoolmanCache).all()).toHaveLength(1);
		const k = kinds().filter((x) => x.k.startsWith('filament.spoolman.'));
		expect(k.map((x) => [x.k, (x.p as { what?: string }).what])).toEqual([
			['filament.spoolman.create', 'vendor'],
			['filament.spoolman.create', 'filament'],
			['filament.spoolman.link', undefined]
		]);
	});
	it('uses an existing vendor by name (any case) and does not create it', async () => {
		const r = await create('editor', { vendorName: ' overture ' });
		expect(r.vendorCreated).toBe(false);
		expect(r.vendorId).toBe(1);
		expect(mock.calls.some((c) => c.startsWith('POST /api/v1/vendor'))).toBe(false);
		expect(mock.vendors.size).toBe(2);
	});
	it('a repeated submit links the same filament instead of creating a second one', async () => {
		const a = await create();
		const b = await create();
		expect(b.reused).toBe(true);
		expect(b.filamentId).toBe(a.filamentId);
		expect(mock.calls.filter((c) => c.startsWith('POST /api/v1/filament'))).toHaveLength(1);
		expect(kinds().filter((x) => x.k === 'filament.spoolman.create')).toHaveLength(2);
	});
	it('reuses only a filament with the same diameter and reports its values', async () => {
		const a = await create();
		const same = await create();
		expect(same.reused).toBe(true);
		expect(same.filament).toMatchObject({
			id: a.filamentId,
			name: 'Fresh Vendor Teal',
			diameter: 1.75
		});
		const other = await create('editor', { diameter: 2.85 });
		expect(other.reused).toBe(false);
		expect(other.filamentId).not.toBe(a.filamentId);
		expect(other.filament.diameter).toBe(2.85);
		expect(mock.filaments.size).toBe(4);
	});
	it('runs under the Spoolman lock', async () => {
		let release!: () => void;
		const held = withSpoolmanLock('org1', () => new Promise<void>((r) => (release = r)));
		expect(await status(create())).toBe(409);
		release();
		await held;
		await new Promise((r) => setTimeout(r, 0));
		expect(await status(create())).toBe(0);
	});
	it('editors only: viewer 403, outsider 404, drafts and no address 400', async () => {
		expect(await status(create('viewer'))).toBe(403);
		expect(await status(create('out'))).toBe(404);
		expect(await status(createFormFor(db, buildId, 'viewer', role, factory))).toBe(403);
		expect(await status(createFormFor(db, buildId, 'out', role, factory))).toBe(404);
		expect(mock.calls.filter((c) => c.startsWith('POST'))).toHaveLength(0);
		setOrgSettings(db, 'org1', { spoolmanUrl: null });
		expect(await status(create())).toBe(400);
	});
	it('validates the body before anything is sent', async () => {
		const bad: Record<string, unknown>[] = [
			{ vendorName: '' },
			{ name: '   ' },
			{ material: 5 },
			{ colorHex: 'blue' },
			{ density: 0 },
			{ density: 'x' },
			{ weightG: -1 },
			{ spoolWeightG: 99999 },
			{ diameter: 0 },
			{ name: 'x'.repeat(201) }
		];
		for (const o of bad) expect(await status(create('editor', o))).toBe(400);
		expect(await status(createAndLinkFilament(db, buildId, 'editor', role, 'x', factory))).toBe(
			400
		);
		expect(mock.calls.filter((c) => c.startsWith('POST'))).toHaveLength(0);
	});
	it('Spoolman down: a readable error, nothing recorded', async () => {
		mock.failing = true;
		expect(await status(create())).toBe(502);
		mock.failing = false;
		expect(slot().spoolmanFilamentId).toBeNull();
		expect(kinds().filter((x) => x.k.startsWith('filament.spoolman.'))).toHaveLength(0);
	});
	it('a response never carries the Spoolman address', async () => {
		const r = await create();
		expect(JSON.stringify(r)).not.toContain(mock.url);
	});
	it('prefills the form from the catalog and lists the vendors', async () => {
		const f = await createFormFor(db, buildId, 'editor', role, factory);
		expect(f.vendors.map((v) => v.name).sort()).toEqual(['Other', 'Overture']);
		expect(f.defaults.density).toBeGreaterThan(0);
		expect(f.defaults.diameter).toBe(1.75);
		expect(f.defaults.weightG).toBeGreaterThan(0);
		expect(f.defaults.colorHex).toMatch(/^#[0-9a-f]{6}$/);
		mock.failing = true;
		const off = await createFormFor(db, buildId, 'editor', role, factory);
		expect(off.vendors).toEqual([]);
		expect(off.error).toBeTruthy();
	});
});

describe('add a spool in Spoolman', () => {
	it('needs a linked colour', async () => {
		expect(await status(addSpoolmanSpool(db, buildId, 'editor', role, { kg: 1 }, factory))).toBe(
			400
		);
	});
	it('creates the spool, records it with its Spoolman id, activity and cache', async () => {
		await setFilamentLink(db, buildId, 'editor', role, { filamentId: 1 }, factory);
		const r = await addSpoolmanSpool(
			db,
			buildId,
			'editor',
			role,
			{ kg: 0.75, note: ' Bob ' },
			factory
		);
		const sp = mock.spools.get(r.spoolmanSpoolId)!;
		expect(sp).toMatchObject({ filament_id: 1, initial_weight: 750, comment: 'Bob' });
		expect(sp.spool_weight).toBeGreaterThan(0);
		expect(slot().spoolAdds).toMatchObject([
			{ id: r.id, kg: 0.75, note: 'Bob', spoolmanSpoolId: r.spoolmanSpoolId, userId: 'editor' }
		]);
		const a = kinds().find((x) => x.k === 'filament.stock.add')!;
		expect(a.p).toMatchObject({ kg: 0.75, spoolmanSpoolId: r.spoolmanSpoolId });
		const cached = db.select().from(spoolmanCache).get()!.data as { spools: { id: number }[] };
		expect(cached.spools.map((s) => s.id)).toContain(r.spoolmanSpoolId);
	});
	it('becomes the current spool only when none is open', async () => {
		mock.spools.get(1)!.used_weight = 1000; // spool 1 is empty
		mock.spools.get(2)!.archived = true;
		await setFilamentLink(db, buildId, 'editor', role, { filamentId: 1 }, factory);
		expect(slot().spoolmanSpoolId).toBeNull();
		const a = await addSpoolmanSpool(db, buildId, 'editor', role, { kg: 1 }, factory);
		expect(a.current).toBe(true);
		expect(slot().spoolmanSpoolId).toBe(a.spoolmanSpoolId);
		const b = await addSpoolmanSpool(db, buildId, 'editor', role, { kg: 1 }, factory);
		expect(b.current).toBe(false);
		expect(slot().spoolmanSpoolId).toBe(a.spoolmanSpoolId);
	});
	it('editors only and validated', async () => {
		await setFilamentLink(db, buildId, 'editor', role, { filamentId: 1 }, factory);
		const posts = () => mock.calls.filter((c) => c.startsWith('POST /api/v1/spool')).length;
		expect(await status(addSpoolmanSpool(db, buildId, 'viewer', role, { kg: 1 }, factory))).toBe(
			403
		);
		expect(await status(addSpoolmanSpool(db, buildId, 'out', role, { kg: 1 }, factory))).toBe(404);
		for (const body of [
			{ kg: 0 },
			{ kg: 100 },
			{ kg: 'x' },
			{ kg: 1, note: 'x'.repeat(201) },
			null
		])
			expect(await status(addSpoolmanSpool(db, buildId, 'editor', role, body, factory))).toBe(400);
		expect(posts()).toBe(0);
	});
	it('Spoolman down: nothing is added to the history', async () => {
		await setFilamentLink(db, buildId, 'editor', role, { filamentId: 1 }, factory);
		mock.failing = true;
		expect(await status(addSpoolmanSpool(db, buildId, 'editor', role, { kg: 1 }, factory))).toBe(
			502
		);
		mock.failing = false;
		expect(slot().spoolAdds).toEqual([]);
	});
	it('app-only spools on a colour stay as they are', async () => {
		addSpool(db, buildId, 'editor', role, { kg: 1 });
		expect(slot().spoolAdds[0].spoolmanSpoolId).toBeUndefined();
	});
});

describe('concurrent adds', () => {
	it('two overlapping adds: at most one becomes current, the slot agrees with it', async () => {
		mock.spools.get(1)!.used_weight = 1000;
		mock.spools.get(2)!.archived = true;
		await setFilamentLink(db, buildId, 'editor', role, { filamentId: 1 }, factory);
		const rs = await Promise.allSettled([
			addSpoolmanSpool(db, buildId, 'editor', role, { kg: 1 }, factory),
			addSpoolmanSpool(db, buildId, 'editor', role, { kg: 1 }, factory)
		]);
		const ok = rs
			.filter((r) => r.status === 'fulfilled')
			.map(
				(r) => (r as PromiseFulfilledResult<{ current: boolean; spoolmanSpoolId: number }>).value
			);
		expect(ok.length).toBeGreaterThanOrEqual(1);
		const cur = ok.filter((r) => r.current);
		expect(cur).toHaveLength(1);
		expect(slot().spoolmanSpoolId).toBe(cur[0].spoolmanSpoolId);
		expect(slot().spoolAdds).toHaveLength(ok.length);
	});
});

describe('remove a Spoolman spool from the history', () => {
	it('keeps a spool another build still uses, even when archiving was asked', async () => {
		await setFilamentLink(db, buildId, 'editor', role, { filamentId: 1 }, factory);
		const a = await addSpoolmanSpool(db, buildId, 'editor', role, { kg: 1 }, factory);
		const templateId = db.select({ id: templates.id }).from(templates).get()!.id;
		const other = createBuild(
			db,
			{ organizationId: 'org1', templateId, designId: null, name: 'B2' },
			'owner'
		);
		db.update(buildFilaments)
			.set({ spoolmanFilamentId: 1, spoolmanSpoolId: a.spoolmanSpoolId })
			.where(and(eq(buildFilaments.buildId, other), eq(buildFilaments.roleKey, role)))
			.run();
		const r = await removeSpoolmanSpoolAdd(db, buildId, 'editor', role, a.id, true, factory);
		expect(r.archived).toBe(false);
		expect(r.warning).toContain(`Spool #${a.spoolmanSpoolId} is still in use by another build`);
		expect(mock.spools.get(a.spoolmanSpoolId)!.archived).toBe(false);
		expect(mock.calls.some((c) => c.startsWith('PATCH'))).toBe(false);
		expect(slot().spoolAdds).toEqual([]);
		const k = kinds().find((x) => x.k === 'filament.stock.remove')!;
		expect(k.p).toMatchObject({ spoolmanSpoolId: a.spoolmanSpoolId, archived: false });
	});
	const added = async () => {
		await setFilamentLink(db, buildId, 'editor', role, { filamentId: 1 }, factory);
		return addSpoolmanSpool(db, buildId, 'editor', role, { kg: 1 }, factory);
	};
	it('archives the spool when asked and the next open spool takes over', async () => {
		const a = await added();
		expect(slot().spoolmanSpoolId).toBe(1);
		await removeSpoolmanSpoolAdd(db, buildId, 'editor', role, a.id, true, factory);
		expect(mock.spools.get(a.spoolmanSpoolId)!.archived).toBe(true);
		expect(slot().spoolAdds).toEqual([]);
		const k = kinds().find((x) => x.k === 'filament.stock.remove')!;
		expect(k.p).toMatchObject({ spoolmanSpoolId: a.spoolmanSpoolId, archived: true });
		const cached = db.select().from(spoolmanCache).get()!.data as {
			spools: { id: number; archived: boolean }[];
		};
		expect(cached.spools.find((s) => s.id === a.spoolmanSpoolId)!.archived).toBe(true);
	});
	it('moves the current spool off an archived one', async () => {
		mock.spools.get(1)!.archived = true;
		mock.spools.get(2)!.archived = true;
		const a = await added();
		expect(slot().spoolmanSpoolId).toBe(a.spoolmanSpoolId);
		await removeSpoolmanSpoolAdd(db, buildId, 'editor', role, a.id, true, factory);
		expect(slot().spoolmanSpoolId).toBeNull();
	});
	it('keeps the spool in Spoolman when not asked to archive', async () => {
		const a = await added();
		await removeSpoolmanSpoolAdd(db, buildId, 'editor', role, a.id, false, factory);
		expect(mock.spools.get(a.spoolmanSpoolId)!.archived).toBe(false);
		expect(mock.calls.some((c) => c.startsWith('PATCH'))).toBe(false);
		expect(slot().spoolAdds).toEqual([]);
		const k = kinds().find((x) => x.k === 'filament.stock.remove')!;
		expect(k.p).toMatchObject({ spoolmanSpoolId: a.spoolmanSpoolId, archived: false });
	});
	it('Spoolman down while archiving: the entry stays, nothing is recorded', async () => {
		const a = await added();
		mock.failing = true;
		expect(
			await status(removeSpoolmanSpoolAdd(db, buildId, 'editor', role, a.id, true, factory))
		).toBe(502);
		mock.failing = false;
		expect(slot().spoolAdds).toHaveLength(1);
		expect(kinds().some((x) => x.k === 'filament.stock.remove')).toBe(false);
	});
	it('a spool already gone from Spoolman still leaves the history', async () => {
		const a = await added();
		mock.spools.delete(a.spoolmanSpoolId);
		const r = await removeSpoolmanSpoolAdd(db, buildId, 'editor', role, a.id, true, factory);
		expect(r.warning).toBeTruthy();
		expect(slot().spoolAdds).toEqual([]);
	});
	it('an entry without a Spoolman spool is just removed', async () => {
		const id = addSpool(db, buildId, 'editor', role, { kg: 1 });
		const r = await removeSpoolmanSpoolAdd(db, buildId, 'editor', role, id, true, factory);
		expect(r.archived).toBeUndefined();
		expect(mock.calls.some((c) => c.startsWith('PATCH'))).toBe(false);
	});
	it('editors only; unknown entry 404', async () => {
		const a = await added();
		expect(
			await status(removeSpoolmanSpoolAdd(db, buildId, 'viewer', role, a.id, true, factory))
		).toBe(403);
		expect(
			await status(removeSpoolmanSpoolAdd(db, buildId, 'out', role, a.id, true, factory))
		).toBe(404);
		expect(
			await status(removeSpoolmanSpoolAdd(db, buildId, 'editor', role, 'nope', true, factory))
		).toBe(404);
		expect(mock.spools.get(a.spoolmanSpoolId)!.archived).toBe(false);
	});
});
