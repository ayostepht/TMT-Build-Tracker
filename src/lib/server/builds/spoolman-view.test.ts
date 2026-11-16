import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDb, runMigrations, type Db } from '../db';
import { buildFilaments, member, organization, spoolmanCache, templates, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { addRun } from './actions';
import { createBuild } from './create';
import { loadBuildView } from './view';
import { prelinkLedgerKey, setDeduction, setOrgSettings } from '../org-settings';
import { filamentStats } from '../../domain/accounting';

let db: Db;
let templateId: string;
const orgId = 'org1';

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	db.insert(user).values({ id: 'owner', name: 'Owner', email: 'o@example.test' }).run();
	db.insert(member)
		.values({
			id: 'm1',
			organizationId: orgId,
			userId: 'owner',
			role: 'owner',
			createdAt: new Date()
		})
		.run();
});

const mk = (kind: 'build' | 'draft' = 'build') =>
	createBuild(db, { organizationId: orgId, templateId, designId: null, name: 'B', kind }, 'owner');
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const link = (buildId: string, role: string, filamentId: number | null, at: Date | null = null) =>
	db
		.update(buildFilaments)
		.set({ spoolmanFilamentId: filamentId, spoolmanLinkedAt: at })
		.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
		.run();

describe('view.spoolman', () => {
	it('reports the workspace mode and an unlinked slot', () => {
		const id = mk();
		const v = view(id);
		expect(v.spoolman).toEqual({ configured: false, keptBy: 'other' });
		const sp = v.filaments[0].spoolman!;
		expect(sp).toMatchObject({ filamentId: null, linkedAt: null, sharedWith: 0, stock: null });
		setOrgSettings(db, orgId, { spoolmanUrl: 'http://spoolman.test', spoolmanKeptBy: 'app' });
		expect(view(id).spoolman).toEqual({ configured: true, keptBy: 'app' });
		expect(view(id).filaments[0].spoolman!.keptBy).toBe('app');
	});

	it('shows link, cached stock (stale on error) and shared builds', () => {
		const id = mk();
		const other = mk();
		const draft = mk('draft');
		const role = view(id).filaments[0].key;
		const at = new Date('2026-03-10T12:00:00Z');
		link(id, role, 7, at);
		link(other, role, 7, at);
		link(draft, role, 7, at);
		db.insert(spoolmanCache)
			.values({
				organizationId: orgId,
				spoolmanFilamentId: 7,
				data: { spools: [{ id: 1, remaining_weight: 420, initial_weight: 1000 }] },
				fetchedAt: new Date(5000),
				error: null
			})
			.run();
		let sp = view(id).filaments.find((f) => f.key === role)!.spoolman!;
		expect(sp).toMatchObject({ filamentId: 7, linkedAt: at.getTime(), sharedWith: 1 });
		expect(sp.stock).toMatchObject({ remainingG: 420, stale: false, fetchedAt: 5000 });
		db.update(spoolmanCache).set({ error: 'timeout' }).run();
		sp = view(id).filaments.find((f) => f.key === role)!.spoolman!;
		expect(sp.stock).toMatchObject({ remainingG: 420, stale: true, error: 'timeout' });
	});

	it('gives runs a creation time and counts pre-link grams, the ledger and the one-off deduction', async () => {
		const id = mk();
		const v0 = view(id);
		const plate = v0.plates.find((p) => !p.perPartRuns && p.parts.length)!;
		const role = v0.parts.find((p) => p.slug === plate.parts[0])!.role;
		const before = addRun(db, id, 'owner', {
			plateNumber: plate.number,
			date: '2026-03-01',
			result: 'Success',
			grams: 100
		});
		expect(view(id).runs[0].createdAt).toBeGreaterThan(0);
		// link after the first run was created, then log another run
		await new Promise((r) => setTimeout(r, 15));
		const linkedAt = new Date();
		await new Promise((r) => setTimeout(r, 15));
		link(id, role, 7, linkedAt);
		const after = addRun(db, id, 'owner', {
			plateNumber: plate.number,
			date: '2999-01-01',
			result: 'Success',
			grams: 40
		});
		setDeduction(db, orgId, after.runId, [[3, 40, role]]);
		setDeduction(db, orgId, before.runId, [[3, 5, role]]);
		setDeduction(db, orgId, prelinkLedgerKey(id, role), [[3, 100, role]]);
		const sp = view(id).filaments.find((f) => f.key === role)!.spoolman!;
		expect(sp.preLinkLoggedG).toBe(100);
		expect(sp.prelinkDeductedG).toBe(100);
		// every run id of this build counts toward the ledger total except the prelink key
		expect(sp.deductedG).toBe(45);
	});

	it('feeds Spare: linked slots use Spoolman, not the app spools', () => {
		const id = mk();
		const role = view(id).filaments[0].key;
		link(id, role, 7, new Date());
		db.insert(spoolmanCache)
			.values({
				organizationId: orgId,
				spoolmanFilamentId: 7,
				data: { spools: [{ id: 1, remaining_weight: 321 }] },
				fetchedAt: new Date(),
				error: null
			})
			.run();
		const s = filamentStats(view(id)).find((x) => x.role === role)!;
		expect(s.haveSource).toBe('spoolman');
		expect(s.haveGrams).toBe(321);
		link(id, role, null, null);
		expect(filamentStats(view(id)).find((x) => x.role === role)!.haveSource).toBe('app');
	});
});
