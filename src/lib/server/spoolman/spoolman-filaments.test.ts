import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { ApiError } from '../access';
import { addRun, deleteRun, linkSpool, undoRun, updateRun } from '../builds/actions';
import { createBuild } from '../builds/create';
import { loadBuildView } from '../builds/view';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildFilaments,
	member,
	organization,
	printRuns,
	spoolmanCache,
	templates,
	user
} from '../db/schema';
import { getDeductions, setOrgSettings, prelinkLedgerKey } from '../org-settings';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { SpoolmanClient } from './client';
import { syncRunDeduction } from './deduct';
import {
	applyPrelinkDeduction,
	refreshBuildSpoolman,
	setCurrentSpool,
	setFilamentLink,
	suggestFilaments,
	undoPrelinkDeduction
} from './link';
import { startMockSpoolman, type MockSpoolman } from './mock-spoolman';
import { withSpoolmanLock } from './lock';
import { rankFilaments } from './suggest';

let mock: MockSpoolman;
const factory = (u: string) => new SpoolmanClient(u, 2000);
const today = () => new Date().toISOString().slice(0, 10);

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

const run = (grams: number, opts: { old?: boolean } = {}) => {
	const id = addRun(db, buildId, 'owner', {
		plateNumber: 1,
		date: today(),
		result: 'Success',
		grams
	}).runId;
	if (opts.old)
		db.update(printRuns)
			.set({ createdAt: new Date(Date.now() - 60_000) })
			.where(eq(printRuns.id, id))
			.run();
	return id;
};
const slot = () => db.select().from(buildFilaments).where(eq(buildFilaments.roleKey, role)).get()!;
const used = (id: number) => mock.spools.get(id)!.used_weight;
const kinds = () => db.select({ k: activity.kind, p: activity.payload }).from(activity).all();
const link = (user = 'editor', filamentId: number | null = 1) =>
	setFilamentLink(db, buildId, user, role, { filamentId }, factory);
const status = async (p: Promise<unknown>) =>
	p.then(
		() => 0,
		(e: ApiError) => e.status
	);

describe('link and unlink', () => {
	it('links a filament, stamps the time, picks the first open spool and caches stock', async () => {
		const r = await link();
		expect(r).toMatchObject({ linked: true, filamentId: 1, spoolId: 1, preLinkLoggedG: 0 });
		const s = slot();
		expect(s.spoolmanFilamentId).toBe(1);
		expect(s.spoolmanLinkedAt).toBeInstanceOf(Date);
		expect(db.select().from(spoolmanCache).all()).toHaveLength(1);
		const sp = loadBuildView(db, buildId, 'owner')!.filaments.find(
			(f) => f.key === role
		)!.spoolman!;
		expect(sp.stock).toMatchObject({ remainingG: 30, stale: false });
		expect(kinds().some((k) => k.k === 'filament.spoolman.link')).toBe(true);
	});

	it('reports grams logged before linking, relinking the same filament keeps the stamp, unlink clears', async () => {
		run(40, { old: true });
		const r = await link();
		expect(r.preLinkLoggedG).toBe(40);
		const at = slot().spoolmanLinkedAt!.getTime();
		await link();
		expect(slot().spoolmanLinkedAt!.getTime()).toBe(at);
		await link('editor', null);
		expect(slot()).toMatchObject({
			spoolmanFilamentId: null,
			spoolmanSpoolId: null,
			spoolmanLinkedAt: null
		});
		expect(kinds().some((k) => k.k === 'filament.spoolman.unlink')).toBe(true);
	});

	it('a legacy spool-only link to the same filament keeps its unknown link time', async () => {
		linkSpool(db, buildId, 'owner', role, { spoolId: 2 });
		await link('editor', 1);
		expect(slot()).toMatchObject({
			spoolmanFilamentId: 1,
			spoolmanSpoolId: 2,
			spoolmanLinkedAt: null
		});
	});

	it('back-fills the filament of a legacy spool-only link', async () => {
		linkSpool(db, buildId, 'owner', role, { spoolId: 1 });
		expect(slot().spoolmanFilamentId).toBeNull();
		await refreshBuildSpoolman(db, buildId, 'viewer', factory);
		expect(slot()).toMatchObject({ spoolmanFilamentId: 1, spoolmanLinkedAt: null });
	});

	it('refuses an unknown filament and a bad body', async () => {
		expect(await status(link('editor', 99))).toBe(404);
		expect(await status(setFilamentLink(db, buildId, 'editor', role, {}, factory))).toBe(400);
		expect(
			await status(setFilamentLink(db, buildId, 'editor', role, { filamentId: 1.5 }, factory))
		).toBe(400);
	});
});

describe('permissions', () => {
	it('viewers read, editors change, outsiders get 404', async () => {
		await link();
		const calls: [string, () => Promise<unknown>][] = [
			['link', () => link('viewer')],
			['spool', () => setCurrentSpool(db, buildId, 'viewer', role, { spoolId: 2 }, factory)],
			['prelink', () => applyPrelinkDeduction(db, buildId, 'viewer', role, factory)],
			['undo', () => undoPrelinkDeduction(db, buildId, 'viewer', role, factory)]
		];
		for (const [, f] of calls) expect(await status(f())).toBe(403);
		expect((await suggestFilaments(db, buildId, 'viewer', role, factory)).suggestions.length).toBe(
			2
		);
		expect((await refreshBuildSpoolman(db, buildId, 'viewer', factory)).configured).toBe(true);
		const outs: (() => Promise<unknown>)[] = [
			() => link('out'),
			() => setCurrentSpool(db, buildId, 'out', role, { spoolId: 2 }, factory),
			() => applyPrelinkDeduction(db, buildId, 'out', role, factory),
			() => undoPrelinkDeduction(db, buildId, 'out', role, factory),
			() => suggestFilaments(db, buildId, 'out', role, factory),
			() => refreshBuildSpoolman(db, buildId, 'out', factory)
		];
		for (const f of outs) expect(await status(f())).toBe(404);
		expect(slot().spoolmanSpoolId).toBe(1); // nothing changed
	});
});

describe('suggestions', () => {
	it('ranks the colour that matches first and falls back to the cache when Spoolman is down', async () => {
		setOrgSettings(db, 'org1', { spoolmanUrl: mock.url });
		db.update(buildFilaments)
			.set({ name: 'Overture Blue', material: 'PETG', hex: '#2b3f9e' })
			.where(eq(buildFilaments.roleKey, role))
			.run();
		const r = await suggestFilaments(db, buildId, 'viewer', role, factory);
		expect(r.suggestions[0].filament.id).toBe(1);
		expect(r.suggestions[0].level).not.toBe('other');
		expect(r.suggestions[1].level).toBe('other');
		await link();
		mock.failing = true;
		const off = await suggestFilaments(db, buildId, 'viewer', role, factory);
		expect(off).toMatchObject({ offline: true });
		expect(off.error).toMatch(/Spoolman/);
		expect(off.suggestions.map((s) => s.filament.id)).toEqual([1]);
	});

	it('uses the SpoolmanDB id when the slot is a catalog colour', () => {
		const f = (id: number, externalId: string | null) => ({
			id,
			name: 'X',
			vendor: null,
			material: null,
			colorHex: null,
			density: null,
			diameter: null,
			weightG: null,
			spoolWeightG: null,
			externalId,
			spools: []
		});
		const ranked = rankFilaments([f(1, null), f(2, 'sdb-1')], { name: 'Whatever' }, {
			sdbId: 'sdb-1'
		} as never);
		expect(ranked[0].filament.id).toBe(2);
		expect(ranked[0].level).toBe('exact');
	});
});

describe('deduction by role', () => {
	beforeEach(async () => {
		await link(); // spool 1 (30 g left), then spool 2
	});

	it('two overlapping syncs of one run deduct once (lock)', async () => {
		mock.useDelayMs = 60;
		const id = run(20);
		const [a, b] = await Promise.all([
			syncRunDeduction(db, buildId, id, factory),
			syncRunDeduction(db, buildId, id, factory)
		]);
		expect(a.warning ?? b.warning).toBeUndefined();
		expect(mock.calls.filter((c) => c.includes('/use'))).toHaveLength(1);
		expect(used(1)).toBe(990);
	});

	it('the lock serialises and survives a failing job', async () => {
		const order: number[] = [];
		const p1 = withSpoolmanLock('k', async () => {
			await new Promise((r) => setTimeout(r, 20));
			order.push(1);
			throw new Error('x');
		});
		const p2 = withSpoolmanLock('k', async () => void order.push(2));
		await p1.catch(() => {});
		await p2;
		expect(order).toEqual([1, 2]);
	});

	it('moves on to the next open spool when one runs out and says so in the activity', async () => {
		const id = run(50);
		await syncRunDeduction(db, buildId, id, factory);
		expect(used(1)).toBe(1000); // took its 30 g
		expect(used(2)).toBe(20); // the rest
		expect(used(3)).toBe(0); // archived spool untouched
		expect(slot().spoolmanSpoolId).toBe(2);
		expect(getDeductions(db, 'org1')[id]).toEqual([
			[1, 30, role],
			[2, 20, role]
		]);
		const adv = kinds().find((k) => k.k === 'filament.spoolman.spool')!;
		expect(adv.p).toMatchObject({ role, spoolId: 2, fromSpoolId: 1, auto: true });
	});

	it('starts on the next spool when the current one is already empty', async () => {
		mock.spools.get(1)!.used_weight = 1000;
		const id = run(10);
		await syncRunDeduction(db, buildId, id, factory);
		expect(used(1)).toBe(1000);
		expect(used(2)).toBe(10);
		expect(slot().spoolmanSpoolId).toBe(2);
	});

	it('keeps the rest on the last spool when none is left', async () => {
		mock.spools.get(2)!.used_weight = 1000;
		const id = run(50);
		await syncRunDeduction(db, buildId, id, factory);
		expect(used(1)).toBe(1020); // the only open spool keeps all of it
		expect(used(2)).toBe(1000);
	});

	it('gives grams back newest spool first on edit, delete and undo', async () => {
		const id = run(50);
		await syncRunDeduction(db, buildId, id, factory);
		updateRun(db, buildId, 'owner', id, { grams: 35 });
		await syncRunDeduction(db, buildId, id, factory);
		expect(used(2)).toBe(5); // 15 g came off the newest entry first
		expect(used(1)).toBe(1000);
		deleteRun(db, buildId, 'owner', id);
		await syncRunDeduction(db, buildId, id, factory);
		expect(used(2)).toBe(0);
		expect(used(1)).toBe(970);
		expect(getDeductions(db, 'org1')[id]).toBeUndefined();

		const id2 = run(10);
		await syncRunDeduction(db, buildId, id2, factory);
		undoRun(db, buildId, 'owner', id2, { parts: [] });
		await syncRunDeduction(db, buildId, id2, factory);
		expect(used(1)).toBe(970);
	});

	it('changing the current spool afterwards does not move deducted grams', async () => {
		const id = run(20);
		await syncRunDeduction(db, buildId, id, factory);
		await setCurrentSpool(db, buildId, 'editor', role, { spoolId: 2 }, factory);
		mock.calls.length = 0;
		await syncRunDeduction(db, buildId, id, factory);
		expect(mock.calls.filter((c) => c.includes('/use') || c.startsWith('PATCH'))).toHaveLength(0);
		expect(used(1)).toBe(990);
		updateRun(db, buildId, 'owner', id, { grams: 25 });
		await syncRunDeduction(db, buildId, id, factory);
		expect(used(1)).toBe(990);
		expect(used(2)).toBe(5); // only the new 5 g go to the spool now in use
		expect(getDeductions(db, 'org1')[id]).toEqual([
			[1, 20, role],
			[2, 5, role]
		]);
	});

	it('refuses a spool of another filament as the current spool', async () => {
		expect(
			await status(setCurrentSpool(db, buildId, 'editor', role, { spoolId: 4 }, factory))
		).toBe(400);
		expect(
			await status(setCurrentSpool(db, buildId, 'editor', role, { spoolId: 'x' }, factory))
		).toBe(400);
	});

	it('kept up to date by something else: nothing is written', async () => {
		setOrgSettings(db, 'org1', { spoolmanKeptBy: 'other' });
		const id = run(20);
		mock.calls.length = 0;
		await syncRunDeduction(db, buildId, id, factory);
		expect(mock.calls).toHaveLength(0);
	});
});

describe('prints logged before the link', () => {
	it('are never deducted, also on edit and undo', async () => {
		const id = run(40, { old: true });
		await link();
		await syncRunDeduction(db, buildId, id, factory);
		updateRun(db, buildId, 'owner', id, { grams: 60 });
		await syncRunDeduction(db, buildId, id, factory);
		undoRun(db, buildId, 'owner', id, { parts: [] });
		await syncRunDeduction(db, buildId, id, factory);
		expect(mock.calls.filter((c) => c.includes('/use') || c.startsWith('PATCH'))).toHaveLength(0);
		const post = run(10); // after the link: counted
		await syncRunDeduction(db, buildId, post, factory);
		expect(used(1)).toBe(980);
	});

	it('a run dated before the link day is pre-link even when logged after it', async () => {
		await link();
		const id = addRun(db, buildId, 'owner', {
			plateNumber: 1,
			date: '2020-01-01',
			result: 'Success',
			grams: 40
		}).runId;
		await syncRunDeduction(db, buildId, id, factory);
		expect(mock.calls.filter((c) => c.includes('/use'))).toHaveLength(0);
	});

	it('the one-off deduction takes them once, can be undone, and is refused twice', async () => {
		run(25, { old: true });
		await link();
		const r = await applyPrelinkDeduction(db, buildId, 'editor', role, factory);
		expect(r.grams).toBe(25);
		expect(used(1)).toBe(995);
		expect(getDeductions(db, 'org1')[prelinkLedgerKey(buildId, role)]).toEqual([[1, 25, role]]);
		expect(
			loadBuildView(db, buildId, 'owner')!.filaments.find((f) => f.key === role)!.spoolman!
				.prelinkDeductedG
		).toBe(25);
		expect(await status(applyPrelinkDeduction(db, buildId, 'editor', role, factory))).toBe(409);
		const u = await undoPrelinkDeduction(db, buildId, 'editor', role, factory);
		expect(u.grams).toBe(25);
		expect(used(1)).toBe(970);
		expect(getDeductions(db, 'org1')[prelinkLedgerKey(buildId, role)]).toBeUndefined();
		expect(await status(undoPrelinkDeduction(db, buildId, 'editor', role, factory))).toBe(404);
		const k = kinds().filter((x) => x.k === 'filament.spoolman.prelink');
		expect(k.map((x) => x.p)).toEqual([
			expect.objectContaining({ grams: 25 }),
			expect.objectContaining({ grams: 25, undone: true })
		]);
	});

	it('is refused when something else keeps Spoolman up to date or nothing was logged', async () => {
		await link();
		expect(await status(applyPrelinkDeduction(db, buildId, 'editor', role, factory))).toBe(400);
		run(5, { old: true });
		setOrgSettings(db, 'org1', { spoolmanKeptBy: 'other' });
		expect(await status(applyPrelinkDeduction(db, buildId, 'editor', role, factory))).toBe(400);
	});
});

describe('cache and offline', () => {
	it('keeps the last stock as stale while Spoolman is unreachable, then recovers', async () => {
		await link();
		const stock = () =>
			loadBuildView(db, buildId, 'owner')!.filaments.find((f) => f.key === role)!.spoolman!.stock!;
		mock.failing = true;
		const r = await refreshBuildSpoolman(db, buildId, 'viewer', factory);
		expect(r.error).toMatch(/Spoolman/);
		expect(stock()).toMatchObject({ remainingG: 30, stale: true });
		mock.failing = false;
		mock.spools.get(1)!.used_weight = 900;
		await refreshBuildSpoolman(db, buildId, 'viewer', factory);
		expect(stock()).toMatchObject({ remainingG: 100, stale: false, error: null });
	});

	it('a deduction that cannot reach Spoolman warns and is caught up later', async () => {
		await link();
		const id = run(10);
		mock.failing = true;
		const r = await syncRunDeduction(db, buildId, id, factory);
		expect(r.warning).toMatch(/Spoolman/);
		expect(getDeductions(db, 'org1')[id]).toBeUndefined();
		mock.failing = false;
		await syncRunDeduction(db, buildId, id, factory);
		expect(used(1)).toBe(980);
	});
});
