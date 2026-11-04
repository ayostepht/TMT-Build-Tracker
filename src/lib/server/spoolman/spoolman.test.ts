import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

interface Spool {
	id: number;
	used_weight: number;
	initial_weight: number;
	remaining_weight: number;
	filament: { name: string; material: string; color_hex: string; vendor: { name: string } };
}

let srv: Server;
let base = '';
let spools: Map<number, Spool>;
let calls: string[];
let fail = false;

beforeEach(async () => {
	spools = new Map([
		[
			1,
			{
				id: 1,
				used_weight: 100,
				initial_weight: 1000,
				remaining_weight: 900,
				filament: {
					name: 'Overture Blue',
					material: 'PETG',
					color_hex: '2B3F9E',
					vendor: { name: 'Overture' }
				}
			}
		],
		[
			2,
			{
				id: 2,
				used_weight: 0,
				initial_weight: 1000,
				remaining_weight: 1000,
				filament: { name: 'Black', material: 'TPU', color_hex: '111111', vendor: { name: 'X' } }
			}
		]
	]);
	calls = [];
	fail = false;
	srv = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			calls.push(`${req.method} ${req.url} ${body}`);
			res.setHeader('content-type', 'application/json');
			if (fail) return res.writeHead(500).end('{"message":"boom"}');
			const m = /^\/api\/v1\/spool\/(\d+)(\/use)?$/.exec(req.url ?? '');
			if (req.url === '/api/v1/info') return res.end('{"version":"0.22.1"}');
			if ((req.url ?? '').startsWith('/api/v1/spool?'))
				return res.end(JSON.stringify([...spools.values()]));
			if (m) {
				const s = spools.get(Number(m[1]));
				if (!s) return res.writeHead(404).end('{}');
				if (m[2] && req.method === 'PUT') {
					s.used_weight += JSON.parse(body).use_weight;
				} else if (req.method === 'PATCH') s.used_weight = JSON.parse(body).used_weight;
				s.remaining_weight = s.initial_weight - s.used_weight;
				return res.end(JSON.stringify(s));
			}
			res.writeHead(404).end('{}');
		});
	});
	await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
});
afterEach(() => new Promise((r) => srv.close(() => r(null))));

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
		fail = true;
		await expect(new SpoolmanClient(base).listSpools()).rejects.toThrow(/500: boom/);
	});
});

describe('run deduction', () => {
	let db: Db;
	let buildId: string;
	const run = (grams: number, result = 'Success') =>
		addRun(db, buildId, 'owner', { plateNumber: 1, date: '2026-11-03', result, grams });
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
		expect(getDeductions(db, 'org1')[id]).toEqual([[1, 40]]);
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

	it('does nothing when the toggle is off or no spool is linked', async () => {
		setOrgSettings(db, 'org1', { spoolmanAutoDeduct: false });
		const id = run(40);
		await syncRunDeduction(db, buildId, id, factory);
		expect(calls).toHaveLength(0);
		setOrgSettings(db, 'org1', { spoolmanAutoDeduct: true });
		db.update(buildFilaments).set({ spoolmanSpoolId: null }).run();
		await syncRunDeduction(db, buildId, id, factory);
		expect(calls).toHaveLength(0);
	});

	it('keeps going and warns when Spoolman is down, then catches up', async () => {
		const id = run(40);
		fail = true;
		const r = await syncRunDeduction(db, buildId, id, factory);
		expect(r.warning).toMatch(/Spoolman/);
		expect(spools.get(1)!.used_weight).toBe(100);
		expect(getDeductions(db, 'org1')[id]).toBeUndefined();
		fail = false;
		await syncRunDeduction(db, buildId, id, factory);
		expect(spools.get(1)!.used_weight).toBe(140);
	});
});
