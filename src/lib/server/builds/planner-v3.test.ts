import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { printerFromCatalog } from '#lib/printers/printer.ts';
import type { BuildPrinter } from '#lib/domain/types.ts';
import { openDb, runMigrations, type Db } from '../db';
import { buildPlates, member, organization, templates, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { addRun } from './actions';
import { createBuild } from './create';
import { updateBuildDesign } from '../designs/mutate';
import {
	loadFootprints,
	loadKitSource,
	PLANNER_VERSION,
	planArrangement,
	writePlan
} from './arrange-plan';
import { arrangeForPrinter, buildArrangement } from './plates';
import { loadBuildView } from './view';

// Planner 3: a plate printed in runs of its own (the wheel rims) stays one plate, and a part that moved
// may join an existing multi-part plate. Arrangements stored by planner 2 keep being checked by planner 2.

let db: Db;
let templateId: string;
const orgId = 'org1';
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-kit-')), 'unused.db');

const cc = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);
/** 300 x 256: the kit's 256 layout is the source, and one rim half (280 x 154) fits but two do not. */
const wide: BuildPrinter = {
	...cc,
	catalogId: null,
	name: 'Custom',
	bedX: 300,
	bedY: 256,
	keepOut: []
};

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	db.insert(user).values({ id: 'owner', name: 'Olive', email: 'o@example.test' }).run();
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

const mk = (printer = wide) =>
	createBuild(
		db,
		{ organizationId: orgId, templateId, designId: null, name: 'B', printer },
		'owner'
	);
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const rows = (id: string) =>
	db
		.select()
		.from(buildPlates)
		.where(eq(buildPlates.buildId, id))
		.orderBy(buildPlates.number)
		.all();

describe('the wheel rims are one plate', () => {
	it('stays the kit plate: both parts, runs, one print on the bed, flagged per part', () => {
		const id = mk();
		const v = view(id);
		// both rim halves are on the kit's plate 13, and nowhere else (the harness and tires of the seed's
		// box footprints may spill over a 300 x 256 bed: they are not the rims)
		expect(v.plates.filter((p) => p.parts.some((s) => s.startsWith('rims-')))).toHaveLength(1);
		const rim = v.plates.find((p) => p.parts.includes('rims-1-4'))!;
		expect(rim.parts).toEqual(['rims-1-4', 'rims-2-3']);
		expect(rim.runs).toBe(2);
		expect(rim.perPartRuns).toBe(true);
		const row = rows(id).find((r) => r.number === rim.number)!;
		expect(row.perPartRuns).toBe(true);
		expect(row.arrangement).toMatchObject({ v: PLANNER_VERSION, perPartRuns: true, runs: 2 });
		// one print = one rim half on the bed (the same object in both colors)
		expect(row.arrangement!.items).toHaveLength(1);
		expect(row.arrangement!.items[0].slug).toBe('rims-1-4');
		expect(buildArrangement(db, id, 'owner').stale).toBe(false);
	});

	it('planner 2 (stored arrangements) split it onto an extra plate', () => {
		const id = mk();
		const v = view(id);
		const fp = loadFootprints(db, templateId);
		const plan = planArrangement(v, fp, null, undefined, loadKitSource(db, v)!, 2)!;
		expect(plan.result.plates.length).toBe(v.plates.length + 1);
	});
});

describe('arrangements stored by planner 2 are not flagged stale, and not rewritten', () => {
	it('a v2 arrangement is checked against planner 2; a color change still makes it stale', () => {
		const id = mk();
		const v = view(id);
		const fp = loadFootprints(db, templateId);
		const v2 = planArrangement(v, fp, null, undefined, loadKitSource(db, v)!, 2)!;
		writePlan(db, id, v2, 2);
		const before = JSON.stringify(rows(id).map((r) => [r.number, r.parts, r.arrangement]));
		expect(rows(id)[0].arrangement).toMatchObject({ v: 2 });
		// the current planner would plan one plate less, yet nothing is stale: the plates were made by planner 2
		const info = buildArrangement(db, id, 'owner');
		expect(info.fresh!.plates).toBe(v2.result.plates.length - 1);
		expect(info.stale).toBe(false);
		// reading never rewrites
		expect(JSON.stringify(rows(id).map((r) => [r.number, r.parts, r.arrangement]))).toBe(before);
		// a started build keeps its plates when a part is recolored: planner 2 sees the change, so it is stale
		addRun(db, id, 'owner', {
			date: '2026-03-01',
			result: 'Success',
			partSlug: 'handle-left',
			grams: 5
		});
		updateBuildDesign(db, id, 'owner', { partRoles: { 'seat-back-top': 'accent' } });
		expect(buildArrangement(db, id, 'owner').stale).toBe(true);
		expect(JSON.stringify(rows(id).map((r) => [r.number, r.parts, r.arrangement]))).toBe(before);
	});

	it('an explicit re-arrange writes planner 3', () => {
		const id = mk();
		const v = view(id);
		const fp = loadFootprints(db, templateId);
		writePlan(db, id, planArrangement(v, fp, null, undefined, loadKitSource(db, v)!, 2)!, 2);
		arrangeForPrinter(db, id, 'owner');
		const now = rows(id);
		expect(now.every((r) => (r.arrangement as { v?: number }).v === PLANNER_VERSION)).toBe(true);
		expect(buildArrangement(db, id, 'owner').stale).toBe(false);
	});
});

describe('a part that moved joins an existing multi-part plate', () => {
	it('an automatic re-arrange after a recolor: the part sits on a kit plate, no plate added', () => {
		const id = mk(cc);
		const kitCount = view(id).plates.length;
		updateBuildDesign(db, id, 'owner', { partRoles: { 'push-pin': 'primary' } });
		const v = view(id);
		expect(v.plates.length).toBe(kitCount);
		const plate = v.plates.find((p) => p.parts.includes('push-pin'))!;
		expect(plate.parts.length).toBeGreaterThanOrEqual(2);
		const pin = v.parts.find((p) => p.slug === 'push-pin')!;
		for (const s of plate.parts) expect(v.parts.find((p) => p.slug === s)!.role).toBe(pin.role);
		// the plate it left lost only the pin
		const left = v.plates.find((p) => p.parts.includes('push-bottom'))!;
		expect(left.parts).not.toContain('push-pin');
		expect(buildArrangement(db, id, 'owner').stale).toBe(false);
		// the stored plate holds the pin's item and the plate's own items did not move
		const stored = rows(id).find((r) => r.number === plate.number)!;
		expect(stored.arrangement!.items.some((i) => i.slug === 'push-pin')).toBe(true);
		expect(stored.arrangement!.utilisation).toBeLessThanOrEqual(0.61);
	});

	it('single-part plates never get it: the plates that are alone in the kit are still alone', () => {
		const id = mk(cc);
		const kit = loadKitSource(db, view(id))!.plates!;
		const lone = kit.filter((p) => p.parts.length === 1).map((p) => p.parts[0]);
		updateBuildDesign(db, id, 'owner', { partRoles: { 'push-pin': 'primary' } });
		const v = view(id);
		for (const s of lone.filter((x) => v.parts.some((p) => p.slug === x)))
			expect(v.plates.find((p) => p.parts.includes(s))!.parts).toEqual([s]);
	});
});
