import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { describeActivity } from '#lib/domain/activity.ts';
import type { BuildPrinter } from '#lib/domain/types.ts';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { printerFromCatalog } from '#lib/printers/printer.ts';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import { buildPlates, builds, member, organization, templates, user } from '../db/schema';
import { timeLeftText, timeStats } from '#lib/domain/accounting.ts';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { addRun, setPrinter, setVariant } from './actions';
import { createBuild } from './create';
import { updateBuildDesign } from '../designs/mutate';
import { arrangeForPrinter, buildArrangement, setPlateLayout } from './plates';
import { onBuildEvents } from './test-helpers';
import { loadBuildView } from './view';
import { eq } from 'drizzle-orm';

let db: Db;
let templateId: string;
const orgId = 'org1';
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-arr-')), 'unused.db');

const cc = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);
const bed = (x: number, y = x, mmSlots = 1) => ({
	...cc,
	catalogId: null,
	name: 'Custom',
	bedX: x,
	bedY: y,
	mmSlots
});

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	for (const [u, role] of [
		['owner', 'owner'],
		['editor', 'editor'],
		['viewer', 'viewer'],
		['outsider', '']
	]) {
		db.insert(user)
			.values({ id: u, name: `User ${u}`, email: `${u}@example.test`, createdAt: new Date() })
			.run();
		if (role)
			db.insert(member)
				.values({ id: `m-${u}`, organizationId: orgId, userId: u, role, createdAt: new Date() })
				.run();
	}
});

const mk = (printer?: BuildPrinter) =>
	createBuild(
		db,
		{ organizationId: orgId, templateId, designId: null, name: 'B', printer },
		'owner'
	);
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const plateOf = (id: string, slug: string) => view(id).plates.find((p) => p.parts.includes(slug))!;

describe('setPrinter', () => {
	it('lets editors and owners set it, not viewers or outsiders', () => {
		const id = mk();
		expect(view(id).printer).toBeNull();
		setPrinter(db, id, 'editor', { printer: cc });
		expect(view(id).printer).toMatchObject({
			name: 'Elegoo Centauri Carbon',
			bedX: 256,
			margin: 1
		});
		expect(() => setPrinter(db, id, 'viewer', { printer: cc })).toThrow(ApiError);
		try {
			setPrinter(db, id, 'viewer', { printer: cc });
		} catch (e) {
			expect((e as ApiError).status).toBe(403);
		}
		try {
			setPrinter(db, id, 'outsider', { printer: cc });
		} catch (e) {
			expect((e as ApiError).status).toBe(404);
		}
	});

	it('validates the input', () => {
		const id = mk();
		for (const bad of [
			{ ...cc, bedX: 10 },
			{ ...cc, bedY: 'x' },
			{ ...cc, name: '' },
			{ ...cc, catalogId: 'not-a-printer' },
			{ ...cc, mmSlots: 0 },
			{ ...cc, margin: 500 }
		])
			expect(() => setPrinter(db, id, 'owner', { printer: bad })).toThrow(/./);
		expect(() => setPrinter(db, id, 'owner', {})).toThrow(ApiError);
	});

	it('clears with null, writes an activity row and emits an event', () => {
		const id = mk();
		const events = onBuildEvents(id);
		setPrinter(db, id, 'owner', { printer: cc });
		expect(events.at(-1)).toMatchObject({ type: 'changed', kind: 'build.printer' });
		const a = view(id).activity.find((x) => x.kind === 'build.printer')!;
		expect(a.kind).toBe('build.printer');
		expect(describeActivity(a, view(id))).toBe(
			'User owner set the printer to Elegoo Centauri Carbon (256×256 mm bed)'
		);
		setPrinter(db, id, 'owner', { printer: null });
		expect(view(id).printer).toBeNull();
	});
});

describe('arrangeForPrinter', () => {
	it('needs a printer', () => {
		const id = mk();
		expect(() => arrangeForPrinter(db, id, 'owner')).toThrow(/printer/i);
	});

	it('is applied on creation when a printer is given', () => {
		const id = mk(cc);
		const v = view(id);
		expect(v.plates.length).toBeGreaterThan(5);
		expect(v.plates.every((p) => p.source === 'arranged')).toBe(true);
		const row = db.select().from(builds).where(eq(builds.id, id)).get()!;
		expect(row.plateLayout).toBe('arranged');
		// every active part sits on exactly... at least one plate
		for (const p of v.parts) expect(v.plates.some((pl) => pl.parts.includes(p.slug))).toBe(true);
	});

	it('permissions: viewers cannot arrange', () => {
		const id = mk(cc);
		expect(() => arrangeForPrinter(db, id, 'viewer')).toThrow(ApiError);
	});

	it('single-filament bed: PETG and TPU never share a plate, and colors stay apart', () => {
		const id = mk(bed(256, 256, 1));
		const v = view(id);
		for (const pl of v.plates) {
			const roles = new Set(pl.parts.map((s) => v.parts.find((p) => p.slug === s)!.role));
			expect(roles.size).toBe(1);
		}
	});

	it('multi-material bed uses fewer plates than a single-filament bed', () => {
		const single = view(mk(bed(350, 320, 1))).plates.length;
		const multi = view(mk(bed(350, 320, 4))).plates.length;
		expect(multi).toBeLessThan(single);
		const v = view(mk(bed(350, 320, 4)));
		for (const pl of v.plates) {
			const mats = new Set(
				pl.parts.map(
					(s) => v.filaments.find((f) => f.key === v.parts.find((p) => p.slug === s)!.role)!.tpu
				)
			);
			expect(mats.size).toBe(1); // PETG and TPU stay apart
		}
	});

	it('warns about parts that do not fit a small bed', () => {
		const id = mk(bed(180));
		const info = buildArrangement(db, id, 'owner');
		const over = info.fresh!.warnings.filter((w) => w.code === 'oversize').map((w) => w.slug);
		expect(over).toContain('wheel-mount-left');
		expect(info.fresh!.warnings.find((w) => w.slug === 'footrest')?.message).toMatch(/Two pieces/);
	});

	it('moving a part to another color re-arranges automatically when no plate has logs', () => {
		const id = mk(bed(256, 256, 1));
		const before = plateOf(id, 'wing-left');
		expect(
			before.parts.every((s) => view(id).parts.find((p) => p.slug === s)!.role === 'accent')
		).toBe(true);
		updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': 'primary' } });
		const after = plateOf(id, 'wing-left');
		expect(
			after.parts.every((s) => view(id).parts.find((p) => p.slug === s)!.role === 'primary')
		).toBe(true);
		expect(buildArrangement(db, id, 'owner').stale).toBe(false);
	});

	it('changing the printer or a variant re-arranges too', () => {
		const id = mk(bed(350, 320, 1));
		const n1 = view(id).plates.length;
		setPrinter(db, id, 'owner', { printer: bed(350, 320, 4) });
		expect(view(id).plates.length).toBeLessThan(n1);
		setVariant(db, id, 'owner', { group: 'footrest', option: 'two-piece' });
		expect(view(id).plates.some((p) => p.parts.includes('footrest-front'))).toBe(true);
		expect(view(id).plates.some((p) => p.parts.includes('footrest'))).toBe(false);
	});

	it('with plate print logs it leaves plates alone, reports stale, and asks before converting', () => {
		const id = mk(bed(256, 256, 1));
		const first = view(id).plates[0];
		addRun(db, id, 'owner', {
			date: '2026-03-01',
			result: 'Success',
			plateNumber: first.number,
			grams: 100
		});
		const platesBefore = JSON.stringify(view(id).plates);
		updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': 'primary' } });
		expect(JSON.stringify(view(id).plates)).toBe(platesBefore);
		const info = buildArrangement(db, id, 'owner');
		expect(info.stale).toBe(true);
		expect(info.hasPlateRuns).toBe(true);
		try {
			arrangeForPrinter(db, id, 'owner');
			expect.unreachable();
		} catch (e) {
			expect((e as ApiError).status).toBe(409);
		}
		const res = arrangeForPrinter(db, id, 'owner', { convertRuns: true });
		expect(res.convertedRuns).toBe(1);
		expect(view(id).runs.every((r) => r.plateNumber === null)).toBe(true);
		expect(buildArrangement(db, id, 'owner').stale).toBe(false);
	});

	it('leaves other layouts alone when the printer changes', () => {
		const id = mk();
		setPlateLayout(db, id, 'owner', { key: 'h2d' });
		const before = JSON.stringify(view(id).plates);
		setPrinter(db, id, 'owner', { printer: cc });
		expect(JSON.stringify(view(id).plates)).toBe(before);
	});

	it('stores positions that fit the bed', () => {
		const id = mk(bed(256, 256, 4));
		const info = buildArrangement(db, id, 'owner');
		expect(info.plates.length).toBe(view(id).plates.length);
		for (const pl of info.plates)
			if (!pl.oversize)
				for (const i of pl.items) {
					expect(i.x - i.w / 2).toBeGreaterThanOrEqual(0.9);
					expect(i.x + i.w / 2).toBeLessThanOrEqual(255.1);
				}
		expect(Object.keys(info.footprints).length).toBeGreaterThan(10);
	});
});

describe('print time estimates on arranged plates', () => {
	it('arranged plates get a time estimate marked as such, and the build has a total', () => {
		const id = mk(cc);
		const v = view(id);
		expect(v.plates.every((p) => p.estSource === 'estimate' && (p.estSeconds ?? 0) > 0)).toBe(true);
		const t = timeStats(v);
		expect(t.known).toBe(true);
		// MakeGood's X/P/A total is ~382 h; ours is the same kit, so the same ballpark
		expect(t.totalSec / 3600).toBeGreaterThan(250);
		expect(t.totalSec / 3600).toBeLessThan(500);
		expect(timeLeftText(t).kind).toBe('estimate');
	});

	it('computes the estimate in the loader when the stored plate has none', () => {
		const id = mk(cc);
		db.update(buildPlates).set({ estSeconds: null }).where(eq(buildPlates.buildId, id)).run();
		expect(view(id).plates.every((p) => (p.estSeconds ?? 0) > 0)).toBe(true);
	});

	it('stores the estimate when arranging', () => {
		const id = mk(cc);
		const rows = db.select().from(buildPlates).where(eq(buildPlates.buildId, id)).all();
		expect(rows.every((r) => (r.estSeconds ?? 0) > 0)).toBe(true);
	});

	it('keeps MakeGood profile times on a plain X/P/A layout', () => {
		const id = mk();
		const p = view(id).plates[0];
		expect(p.estSource).toBe('profile');
	});
});
