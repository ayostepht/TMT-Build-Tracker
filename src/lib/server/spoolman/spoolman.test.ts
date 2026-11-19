import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { addRun, deleteRun, linkSpool, updateRun, undoRun } from '../builds/actions';
import { createBuild } from '../builds/create';
import { loadBuildView } from '../builds/view';
import { openDb, runMigrations, type Db } from '../db';
import { buildFilaments, member, organization, templates, user } from '../db/schema';
import { getDeductions, setOrgSettings } from '../org-settings';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { normalizeSpoolmanUrl, SpoolmanClient, SpoolmanError } from './client';
import { syncRunDeduction } from './deduct';
import { startMockSpoolman, type MockSpoolman } from './mock-spoolman';

let mock: MockSpoolman;
let base = '';
beforeAll(async () => {
	mock = await startMockSpoolman();
	base = mock.url;
	calls = mock.calls;
});
afterAll(() => mock.close());
beforeEach(() => {
	mock.reset();
	mock.addFilament({
		name: 'Overture Blue',
		vendor: { id: 1, name: 'Overture' },
		material: 'PETG',
		color_hex: '2B3F9E'
	});
	mock.addFilament({
		name: 'Black',
		vendor: { id: 2, name: 'X' },
		material: 'TPU',
		color_hex: '111111'
	});
	mock.addSpool({ filament_id: 1, used_weight: 100 });
	mock.addSpool({ filament_id: 2 });
});
const spools = {
	get: (id: number) => ({ used_weight: mock.spools.get(id)!.used_weight })
};
let calls: string[] = [];

describe('SpoolmanClient', () => {
	it('normalises addresses', () => {
		expect(normalizeSpoolmanUrl('192.168.0.5:7912')).toBe('http://192.168.0.5:7912');
		expect(normalizeSpoolmanUrl('https://s.example/spoolman/api/v1/')).toBe(
			'https://s.example/spoolman'
		);
		expect(() => normalizeSpoolmanUrl('ftp://x')).toThrow(SpoolmanError);
		expect(() => normalizeSpoolmanUrl('  ')).toThrow(/address/);
	});
	it('lists spools with colors and remaining grams', async () => {
		const list = await new SpoolmanClient(base).listSpools();
		expect(list[0]).toMatchObject({
			id: 1,
			name: 'Overture Blue',
			vendor: 'Overture',
			material: 'PETG',
			colorHex: '#2b3f9e',
			remainingG: 900
		});
		expect((await new SpoolmanClient(base).health()).version).toBe('0.22.1');
	});
	it('gives clear errors when unreachable or failing', async () => {
		await expect(new SpoolmanClient('http://127.0.0.1:1', 500).listSpools()).rejects.toThrow(
			/Cannot reach Spoolman/
		);
		mock.failing = true;
		await expect(new SpoolmanClient(base).listSpools()).rejects.toThrow(/^Spoolman returned 500$/); // the remote's own text ("boom") is not repeated
	});
});

describe('run deduction', () => {
	let db: Db;
	let buildId: string;
	const run = (grams: number, result = 'Success') =>
		addRun(db, buildId, 'owner', { plateNumber: 1, date: '2026-11-03', result, grams }).runId;
	const factory = (u: string) => new SpoolmanClient(u);

	beforeEach(() => {
		db = openDb(':memory:');
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		db.insert(user).values({ id: 'owner', name: 'O', email: 'o@example.test' }).run();
		db.insert(organization)
			.values({ id: 'org1', name: 'C', slug: 'c', createdAt: new Date() })
			.run();
		db.insert(member)
			.values({
				id: 'm',
				organizationId: 'org1',
				userId: 'owner',
				role: 'owner',
				createdAt: new Date()
			})
			.run();
		const templateId = db.select({ id: templates.id }).from(templates).get()!.id;
		buildId = createBuild(
			db,
			{ organizationId: 'org1', templateId, designId: null, name: 'B' },
			'owner'
		);
		setOrgSettings(db, 'org1', { spoolmanUrl: base, spoolmanAutoDeduct: true });
		// plate 1 (Handle Left) uses the role of handle-left
		const role = loadBuildView(db, buildId, 'owner')!.parts.find(
			(p) => p.slug === 'handle-left'
		)!.role;
		linkSpool(db, buildId, 'owner', role, { spoolId: 1, spoolName: 'Overture Blue' });
	});

	it('deducts once per run, even if synced repeatedly', async () => {
		const id = run(40);
		const a = await syncRunDeduction(db, buildId, id, factory);
		expect(a.warning).toBeUndefined();
		expect(spools.get(1)!.used_weight).toBe(140);
		await syncRunDeduction(db, buildId, id, factory);
		await syncRunDeduction(db, buildId, id, factory);
		expect(spools.get(1)!.used_weight).toBe(140);
		expect(calls.filter((c) => c.includes('/use'))).toHaveLength(1);
		expect(getDeductions(db, 'org1')[id]).toEqual([[1, 40, expect.any(String)]]);
	});

	it('adjusts on edit and gives grams back on delete and undo', async () => {
		const id = run(40);
		await syncRunDeduction(db, buildId, id, factory);
		updateRun(db, buildId, 'owner', id, { grams: 25 });
		await syncRunDeduction(db, buildId, id, factory);
		expect(spools.get(1)!.used_weight).toBe(125);
		deleteRun(db, buildId, 'owner', id);
		await syncRunDeduction(db, buildId, id, factory);
		expect(spools.get(1)!.used_weight).toBe(100);
		expect(getDeductions(db, 'org1')[id]).toBeUndefined();

		const id2 = run(10, 'Failed'); // failures use filament too
		await syncRunDeduction(db, buildId, id2, factory);
		expect(spools.get(1)!.used_weight).toBe(110);
		undoRun(db, buildId, 'owner', id2, { parts: [] });
		await syncRunDeduction(db, buildId, id2, factory);
		expect(spools.get(1)!.used_weight).toBe(100);
	});

	it('deducts both halves of a Partial with per-part results, and gives both back on undo', async () => {
		const v = loadBuildView(db, buildId, 'owner')!;
		const plate = v.plates.find((p) => !p.perPartRuns && p.runs === 1 && p.parts.length >= 2)!;
		for (const s of plate.parts) {
			const role = v.parts.find((p) => p.slug === s)!.role;
			linkSpool(db, buildId, 'owner', role, { spoolId: 1 });
		}
		const { runId, runIds } = addRun(db, buildId, 'owner', {
			plateNumber: plate.number,
			date: '2026-11-03',
			result: 'Partial',
			hours: 4,
			split: { keptSlugs: [plate.parts[0]], keptGrams: 60, lostGrams: 40 }
		});
		expect(runIds).toHaveLength(2);
		for (const id of runIds) await syncRunDeduction(db, buildId, id, factory);
		expect(spools.get(1)!.used_weight).toBe(200);
		expect(getDeductions(db, 'org1')[runId].reduce((a, e) => a + e[1], 0)).toBe(60);
		const removed = undoRun(db, buildId, 'owner', runId, { parts: [], runIds });
		for (const id of removed) await syncRunDeduction(db, buildId, id, factory);
		expect(spools.get(1)!.used_weight).toBe(100);
		// An older Partial row (no split) is still never deducted.
		const old = run(25, 'Partial');
		await syncRunDeduction(db, buildId, old, factory);
		expect(spools.get(1)!.used_weight).toBe(100);
	});

	it('does nothing when the toggle is off or no spool is linked', async () => {
		setOrgSettings(db, 'org1', { spoolmanAutoDeduct: false });
		const id = run(40);
		await syncRunDeduction(db, buildId, id, factory);
		expect(calls.filter((c) => !c.startsWith('GET /api/v1/info'))).toHaveLength(0);
		setOrgSettings(db, 'org1', { spoolmanAutoDeduct: true });
		db.update(buildFilaments).set({ spoolmanSpoolId: null }).run();
		await syncRunDeduction(db, buildId, id, factory);
		expect(calls.filter((c) => !c.startsWith('GET /api/v1/info'))).toHaveLength(0);
	});

	it('keeps going and warns when Spoolman is down, then catches up', async () => {
		const id = run(40);
		mock.failing = true;
		const r = await syncRunDeduction(db, buildId, id, factory);
		expect(r.warning).toMatch(/Spoolman/);
		expect(spools.get(1)!.used_weight).toBe(100);
		expect(getDeductions(db, 'org1')[id]).toBeUndefined();
		mock.failing = false;
		await syncRunDeduction(db, buildId, id, factory);
		expect(spools.get(1)!.used_weight).toBe(140);
	});
});
