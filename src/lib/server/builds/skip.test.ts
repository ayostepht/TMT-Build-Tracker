import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { filamentStats, timeStats } from '#lib/domain/accounting.ts';
import { partBySlug } from '#lib/domain/custom.ts';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildCustomPieces,
	buildParts,
	buildPlates,
	builds,
	member,
	organization,
	printerJobs,
	printers,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { updateBuildDesign } from '../designs/mutate';
import { addRun, setPartStatus, skipParts, skipPartsTx } from './actions';
import { createBuild } from './create';
import { buildRows } from './list';
import { loadBuildView, startedBuildIds as startedIds } from './view';

let db: Db;
let id: string;
let templateId: string;

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: 'org1', name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	db.insert(user).values({ id: 'owner', name: 'Olive', email: 'o@example.test' }).run();
	db.insert(user).values({ id: 'viewer', name: 'Vic', email: 'v@example.test' }).run();
	for (const [mid, uid, role] of [
		['m1', 'owner', 'owner'],
		['m2', 'viewer', 'viewer']
	])
		db.insert(member)
			.values({ id: mid, organizationId: 'org1', userId: uid, role, createdAt: new Date() })
			.run();
	id = createBuild(db, { organizationId: 'org1', templateId, designId: null, name: 'A' }, 'owner');
});

const view = () => loadBuildView(db, id, 'owner')!;
const skip = (slugs: string[], on = true, who = 'owner') =>
	skipParts(db, id, who, { slugs, skip: on });
const status = (e: () => void) => {
	try {
		e();
	} catch (x) {
		return x instanceof ApiError ? x.status : -1;
	}
	return 0;
};

describe('Not printing (skip / restore)', () => {
	it('takes parts out of parts, state, plates and totals, and restore puts them back', () => {
		const v0 = view();
		const plate = v0.plates.find((p) => p.parts.includes('handle-left'))!;
		const grams0 = filamentStats(v0).reduce((a, f) => a + f.total, 0);
		const sec0 = timeStats(v0).totalSec;
		skip(['handle-left']);
		const v = view();
		expect(v.parts.some((p) => p.slug === 'handle-left')).toBe(false);
		expect(v.state['handle-left']).toBeUndefined();
		expect(v.allParts.some((p) => p.slug === 'handle-left')).toBe(true);
		expect(v.skipped).toEqual([
			expect.objectContaining({
				slug: 'handle-left',
				status: 'To print',
				plateNumber: plate.number,
				custom: false
			})
		]);
		// handle-left is alone on its plate: the plate disappears and the totals drop
		expect(v.plates.some((p) => p.number === plate.number)).toBe(false);
		expect(timeStats(v).totalSec).toBeLessThan(sec0);
		expect(filamentStats(v).reduce((a, f) => a + f.total, 0)).toBeLessThanOrEqual(grams0);
		expect(db.select().from(activity).where(eq(activity.kind, 'part.skip')).all()).toHaveLength(1);
		skip(['handle-left'], false);
		const back = view();
		expect(back.parts.some((p) => p.slug === 'handle-left')).toBe(true);
		expect(back.plates.some((p) => p.number === plate.number)).toBe(true);
		expect(back.skipped).toEqual([]);
		expect(timeStats(back).totalSec).toBe(sec0);
	});

	it('restore keeps the stored status and does not recompute from runs', () => {
		const pl = view().plates.find((p) => p.parts.length > 1)!;
		const [a, b] = pl.parts;
		addRun(db, id, 'owner', {
			plateNumber: pl.number,
			partSlug: null,
			partSlugs: null,
			date: '2026-11-01',
			result: 'Success',
			grams: 10,
			hours: 1,
			printer: null,
			note: ''
		});
		expect(view().state[a].status).toBe('Printed');
		setPartStatus(db, id, 'owner', a, { status: 'Reprint' });
		skip([a]);
		expect(view().skipped[0]).toMatchObject({ slug: a, status: 'Reprint' });
		expect(view().state[b].status).toBe('Printed');
		skip([a], false);
		// the run history says Printed; the stored status (Reprint) simply comes back
		expect(view().state[a].status).toBe('Reprint');
	});

	it('skipped parts do not count as started, in the view or the batched readers', () => {
		skip(['handle-left']);
		expect(view().started.totalParts).toBe(view().parts.length);
		db.update(buildParts)
			.set({ status: 'Printed' })
			.where(eq(buildParts.partSlug, 'handle-left'))
			.run();
		expect(view().started.started).toBe(false);
		expect(startedIds(db, [id]).has(id)).toBe(false);
		const row = buildRows(db, ['org1']).find((r) => r.id === id)!;
		expect(row.printed).toBe(0);
		expect(row.total).toBe(view().parts.length);
		skip(['handle-left'], false);
		expect(startedIds(db, [id]).has(id)).toBe(true);
	});

	it('refuses a Printing part and a part on a live printer job (409)', () => {
		setPartStatus(db, id, 'owner', 'handle-left', { status: 'Printing' });
		expect(status(() => skip(['handle-left']))).toBe(409);
		setPartStatus(db, id, 'owner', 'handle-left', { status: 'To print' });
		const p = db
			.insert(printers)
			.values({
				organizationId: 'org1',
				name: 'P',
				kind: 'elegoo-sdcp',
				host: 'h',
				enabled: true
			} as never)
			.returning({ id: printers.id })
			.get();
		db.insert(printerJobs)
			.values({
				printerId: p.id,
				buildId: id,
				plateNumber: 1,
				partSlugs: ['handle-left'],
				status: 'printing',
				startedAt: new Date()
			})
			.run();
		expect(status(() => skip(['handle-left']))).toBe(409);
		expect(view().skipped).toEqual([]);
	});

	it('refuses drafts, viewers and unknown slugs', () => {
		expect(status(() => skip(['handle-left'], true, 'viewer'))).toBe(403);
		expect(status(() => skip(['nope']))).toBe(400);
		expect(status(() => skip([]))).toBe(400);
		expect(status(() => skip(['handle-left'], false))).toBe(0); // nothing to restore: no-op
		expect(db.select().from(activity).where(eq(activity.kind, 'part.restore')).all()).toHaveLength(
			0
		);
		db.update(builds).set({ kind: 'draft' }).where(eq(builds.id, id)).run();
		expect(status(() => skip(['handle-left']))).toBe(400);
		expect(view().skipped).toEqual([]);
	});

	it('records the plate in the payload when a whole plate is skipped', () => {
		const pl = view().plates.find((p) => p.parts.length > 1)!;
		skip(pl.parts);
		const row = db.select().from(activity).where(eq(activity.kind, 'part.skip')).get()!;
		expect(row.payload).toMatchObject({ slugs: pl.parts, plate: { number: pl.number } });
	});

	it('skipPartsTx validates and writes without an activity row', () => {
		const names = db.transaction((tx) =>
			skipPartsTx(tx as never, view(), ['handle-left'], true, new Date())
		);
		expect(names.names).toHaveLength(1);
		expect(view().skipped).toHaveLength(1);
		expect(db.select().from(activity).where(eq(activity.kind, 'part.skip')).all()).toHaveLength(0);
	});
});

function addPiece(role = 'accent') {
	db.insert(buildCustomPieces)
		.values({
			id: 'pc1',
			buildId: id,
			name: 'Beta handle',
			fileName: 'beta.3mf',
			sliced: true,
			replaces: ['handle-left'],
			parts: [{ slug: 'custom-aa11', name: 'Beta handle', role }],
			createdAt: new Date()
		})
		.run();
	db.insert(buildParts).values({ buildId: id, partSlug: 'custom-aa11' }).run();
	db.insert(buildPlates)
		.values({
			buildId: id,
			number: 90,
			name: 'Beta handle',
			estSeconds: 3600,
			runs: 1,
			parts: ['custom-aa11'],
			slicerGrams: 20,
			filamentGrams: { accent: 15, primary: 5 },
			source: 'custom:pc1'
		})
		.run();
}

describe('custom pieces in the view', () => {
	it('merges custom parts into parts (not allParts) with role, grams and time', () => {
		addPiece();
		const v = view();
		const cp = v.parts.find((p) => p.slug === 'custom-aa11')!;
		expect(cp).toMatchObject({ section: 'Custom', role: 'accent', custom: { pieceId: 'pc1' } });
		expect(v.parts[v.parts.length - 1].slug).toBe('custom-aa11');
		expect(v.allParts.some((p) => p.slug === 'custom-aa11')).toBe(false);
		expect(partBySlug(v, 'custom-aa11')?.name).toBe('Beta handle');
		const pl = v.plates.find((p) => p.number === 90)!;
		expect(pl).toMatchObject({
			source: 'custom:pc1',
			estSeconds: 3600,
			estSource: 'slicer',
			runNote: null
		});
		expect(v.customPieces).toEqual([
			expect.objectContaining({
				id: 'pc1',
				parts: ['custom-aa11'],
				plates: [90],
				replaces: ['handle-left'],
				removable: true
			})
		]);
		// file role grams: all roles of the file, not only the part's role
		const stat = Object.fromEntries(filamentStats(v).map((f) => [f.role, f.total]));
		expect(stat.primary).toBeGreaterThanOrEqual(5);
	});

	it('is not removable once it has a run or is printing', () => {
		addPiece();
		setPartStatus(db, id, 'owner', 'custom-aa11', { status: 'Printing' });
		expect(view().customPieces[0].removable).toBe(false);
		setPartStatus(db, id, 'owner', 'custom-aa11', { status: 'To print' });
		expect(view().customPieces[0].removable).toBe(true);
		addRun(db, id, 'owner', {
			plateNumber: 90,
			partSlug: null,
			partSlugs: null,
			date: '2026-11-01',
			result: 'Success',
			grams: 20,
			hours: 1,
			printer: null,
			note: ''
		});
		expect(view().customPieces[0].removable).toBe(false);
	});

	it('a custom part can be skipped and brought back', () => {
		addPiece();
		skip(['custom-aa11']);
		const v = view();
		expect(v.plates.some((p) => p.number === 90)).toBe(false);
		expect(v.skipped[0]).toMatchObject({ slug: 'custom-aa11', custom: true, plateNumber: 90 });
		expect(v.customPieces[0].parts).toEqual(['custom-aa11']);
		skip(['custom-aa11'], false);
		expect(view().plates.some((p) => p.number === 90)).toBe(true);
	});

	it('removing a colour re-keys custom parts and needs replaceWith', () => {
		updateBuildDesign(db, id, 'owner', {
			addRole: { key: 'extra', name: 'Extra', material: 'PLA', hex: '#123456' }
		} as never);
		addPiece('extra');
		expect(status(() => updateBuildDesign(db, id, 'owner', { removeRole: 'extra' } as never))).toBe(
			409
		);
		updateBuildDesign(db, id, 'owner', { removeRole: 'extra', replaceWith: 'accent' } as never);
		expect(view().parts.find((p) => p.slug === 'custom-aa11')!.role).toBe('accent');
		const row = db.select().from(builds).where(eq(builds.id, id)).get()!;
		expect(JSON.stringify(row.design)).not.toContain('custom-aa11');
	});
});
