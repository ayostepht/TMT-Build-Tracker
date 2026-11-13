import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, runMigrations, type Db } from '../db';
import {
	buildParts,
	member,
	organization,
	printerJobs,
	printers,
	printRuns,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { addRun, deleteRun, printingAction, undoRun } from './actions';
import { createBuild } from './create';
import { createPrinter } from '../printers/store';

let db: Db;
let buildId: string;
let printerId: string;
const T0 = new Date(Date.now() - 46 * 60_000);

const part = () =>
	db.select().from(buildParts).where(eq(buildParts.partSlug, 'handle-left')).get()!;

function liveJob(status = 'printing') {
	db.insert(printerJobs)
		.values({
			printerId,
			buildId,
			plateNumber: 1,
			partSlugs: ['handle-left'],
			status,
			startedAt: T0
		})
		.run();
}

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	db.insert(user).values({ id: 'owner', name: 'Olive', email: 'o@example.test' }).run();
	db.insert(organization)
		.values({ id: 'org1', name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	db.insert(member)
		.values({
			id: 'm1',
			organizationId: 'org1',
			userId: 'owner',
			role: 'owner',
			createdAt: new Date()
		})
		.run();
	const templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	buildId = createBuild(
		db,
		{ organizationId: 'org1', templateId, designId: null, name: 'Columbus' },
		'owner'
	);
	printerId = createPrinter(db, 'org1', 'owner', {
		name: 'Shop Centauri',
		kind: 'elegoo-sdcp',
		host: '10.0.0.9',
		catalogId: 'elegoo-centauri-carbon'
	}).id;
	db.update(printers)
		.set({ lastStatus: { state: 'printing', elapsedSec: 2760, remainingSec: 4440 } })
		.where(eq(printers.id, printerId))
		.run();
});

const failed = { plateNumber: 1, result: 'Failed', date: '2026-11-12', grams: 10 };

describe('logging an older attempt while the plate prints again', () => {
	it('start from a live job takes its start and estimate; no live job takes now', () => {
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['handle-left'] });
		const t = part().startedAt!.getTime();
		expect(Math.abs(t - Date.now())).toBeLessThan(5000);
		expect(part().runEstSeconds).toBeNull();
		printingAction(db, buildId, 'owner', { action: 'stop', slugs: ['handle-left'] });

		liveJob();
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['handle-left'] });
		expect(part().startedAt!.getTime()).toBe(T0.getTime());
		expect(part().runEstSeconds).toBe(7200);
	});

	it.each([
		['negative elapsed', { elapsedSec: -5e9, remainingSec: 5e9 + 3600 }],
		['negative remaining', { elapsedSec: 3600, remainingSec: -10 }],
		['NaN', { elapsedSec: NaN, remainingSec: 100 }],
		['strings', { elapsedSec: '100', remainingSec: '100' }],
		['over 30 days', { elapsedSec: 2_000_000, remainingSec: 1_000_000 }]
	])('start ignores an absurd printer estimate (%s) but keeps the start', (_n, status) => {
		db.update(printers)
			.set({ lastStatus: { state: 'printing', ...status } as never })
			.where(eq(printers.id, printerId))
			.run();
		liveJob();
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['handle-left'] });
		expect(part().startedAt!.getTime()).toBe(T0.getTime());
		expect(part().runEstSeconds).toBeNull();
	});

	it('a Failed run keeps the plate Printing with its start; delete and undo too', () => {
		liveJob();
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['handle-left'] });
		const before = part();
		const runId = addRun(db, buildId, 'owner', failed);
		expect(db.select().from(printRuns).all()).toHaveLength(1);
		expect(part()).toMatchObject({
			status: 'Printing',
			startedAt: before.startedAt,
			runEstSeconds: 7200
		});
		deleteRun(db, buildId, 'owner', runId);
		expect(part()).toMatchObject({ status: 'Printing', startedAt: before.startedAt });

		const id2 = addRun(db, buildId, 'owner', failed);
		undoRun(db, buildId, 'owner', id2, {
			parts: [{ slug: 'handle-left', status: 'To print', comps: {} }]
		});
		expect(part()).toMatchObject({ status: 'Printing', startedAt: before.startedAt });
	});

	it('without a live job the Failed run flags Reprint as before', () => {
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['handle-left'] });
		addRun(db, buildId, 'owner', failed);
		expect(part()).toMatchObject({ status: 'Reprint', startedAt: null });
	});
});
