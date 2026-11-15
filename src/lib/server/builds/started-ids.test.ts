import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDb, runMigrations, type Db } from '../db';
import {
	buildParts,
	member,
	organization,
	printerJobs,
	printers,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { addRun } from './actions';
import { createBuild } from './create';
import { createPrinter } from '../printers/store';
import { loadBuildView, startedBuildIds } from './view';

let db: Db;
let templateId: string;
let printerId: string;

const make = (name: string) =>
	createBuild(db, { organizationId: 'org1', templateId, designId: null, name }, 'owner');
const setStatus = (buildId: string, status: string) =>
	db
		.update(buildParts)
		.set({ status })
		.where(and(eq(buildParts.buildId, buildId), eq(buildParts.partSlug, 'handle-left')))
		.run();

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
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	printerId = createPrinter(db, 'org1', 'owner', {
		name: 'Shop Centauri',
		kind: 'elegoo-sdcp',
		host: '10.0.0.9',
		catalogId: 'elegoo-centauri-carbon'
	}).id;
	db.update(printers)
		.set({ lastStatus: { state: 'printing' } })
		.where(eq(printers.id, printerId))
		.run();
});

describe('startedBuildIds', () => {
	it('agrees with buildStarted(loadBuildView) for each kind of start', () => {
		const none = make('None');
		const run = make('Run');
		const reprint = make('Reprint');
		const printing = make('Printing');
		const live = make('Live');
		const paused = make('Paused');
		addRun(db, run, 'owner', { plateNumber: 1, result: 'Failed', date: '2026-11-12', grams: 10 });
		setStatus(reprint, 'Reprint');
		setStatus(printing, 'Printing');
		for (const [buildId, status] of [
			[live, 'printing'],
			[paused, 'paused']
		] as const)
			db.insert(printerJobs)
				.values({
					printerId,
					buildId,
					plateNumber: 1,
					partSlugs: ['handle-left'],
					status,
					startedAt: new Date()
				})
				.run();
		const all = [none, run, reprint, printing, live, paused];
		const got = startedBuildIds(db, all);
		for (const id of all)
			expect(got.has(id), id).toBe(loadBuildView(db, id, 'owner')!.started.started);
		expect(got.has(none)).toBe(false);
		expect([...got].sort()).toEqual([run, reprint, printing, live, paused].sort());
	});
	it('ignores finished jobs and handles an empty list', () => {
		const b = make('Done');
		db.insert(printerJobs)
			.values({
				printerId,
				buildId: b,
				plateNumber: 1,
				partSlugs: [],
				status: 'finished',
				startedAt: new Date()
			})
			.run();
		expect(startedBuildIds(db, [b]).size).toBe(0);
		expect(startedBuildIds(db, []).size).toBe(0);
	});
});
