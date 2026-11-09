import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { printerFromCatalog } from '#lib/printers/printer.ts';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import type { PrinterStatus } from '#lib/printers/status.ts';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildParts,
	builds,
	member,
	organization,
	printRuns,
	printerJobs,
	printers,
	templates,
	user
} from '../db/schema';
import { createBuild } from '../builds/create';
import { addRun, printingAction, updatePlate } from '../builds/actions';
import { loadBuildView } from '../builds/view';
import { onBuildEvents } from '../builds/test-helpers';
import { setOrgSettings } from '../org-settings';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { subscribePrinterEvents } from './bus';
import { buildJobs, confirmJob, dismissJob, linkJob, processStatus } from './jobs';
import { Supervisor } from './supervisor';
import { createPrinter } from './store';
import type { ConnectFn, StatusCallback } from './types';

let db: Db;
let buildId: string;
let printerId: string;
const T0 = new Date('2026-11-03T10:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

const printing = (
	file: string,
	progress: number,
	elapsedSec: number,
	extra: Partial<PrinterStatus> = {}
): PrinterStatus => ({
	state: 'printing',
	progress,
	fileName: file,
	elapsedSec,
	remainingSec: 3000,
	layer: 10,
	totalLayers: 100,
	...extra
});
const jobs = () => db.select().from(printerJobs).all();
const partStatus = (slug: string) =>
	db.select().from(buildParts).where(eq(buildParts.partSlug, slug)).get()!.status;

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
		{
			organizationId: 'org1',
			templateId,
			designId: null,
			name: 'Columbus'
		},
		'owner'
	);
	// Plan the build for this printer without re-arranging the template's plates.
	db.update(builds)
		.set({ printer: printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 1) })
		.where(eq(builds.id, buildId))
		.run();
	printerId = createPrinter(db, 'org1', 'owner', {
		name: 'Shop Centauri',
		kind: 'elegoo-sdcp',
		host: '10.0.0.9',
		catalogId: 'elegoo-centauri-carbon'
	}).id;
});

describe('job lifecycle', () => {
	it('links by file name, resumes, finishes and waits for confirmation', () => {
		const ev = onBuildEvents(buildId);
		const file = 'Plate 1 - Handle Left.gcode';
		processStatus(db, printerId, printing(file, 5, 300), at(5));
		let [j] = jobs();
		expect(jobs()).toHaveLength(1);
		expect(j).toMatchObject({ buildId, plateNumber: 1, status: 'printing' });
		expect(j.partSlugs).toEqual(['handle-left']);
		expect(j.startedAt!.getTime()).toBe(at(0).getTime());
		expect(partStatus('handle-left')).toBe('Printing');
		expect(ev.some((e) => e.kind === 'printer.job.start')).toBe(true);

		// More statuses, and a "restart" (same status again) keep one job.
		processStatus(db, printerId, printing(file, 40, 1500), at(25));
		processStatus(db, printerId, printing(file, 40, 1500), at(25));
		expect(jobs()).toHaveLength(1);
		expect(jobs()[0].progress).toBe(40);
		expect(buildJobs(db, buildId, 'org1')).toHaveLength(1);

		processStatus(
			db,
			printerId,
			{ state: 'done', progress: 100, fileName: file, elapsedSec: 3600 },
			at(60)
		);
		[j] = jobs();
		expect(j.status).toBe('done');
		expect(j.runId).toBeNull();
		expect(db.select().from(printRuns).all()).toHaveLength(0);
		const pending = buildJobs(db, buildId, 'org1');
		expect(pending[0].pendingConfirm).toBe(true);
		expect(
			db.select().from(activity).where(eq(activity.kind, 'printer.job.done')).get()
		).toBeTruthy();

		// Same "done" status again must not create or change anything.
		processStatus(db, printerId, { state: 'done', progress: 100, fileName: file }, at(61));
		expect(jobs()).toHaveLength(1);

		const runId = confirmJob(db, j.id, 'org1', 'owner', { result: 'Success', grams: 33 });
		const run = db.select().from(printRuns).get()!;
		expect(run).toMatchObject({
			id: runId,
			plateNumber: 1,
			result: 'Success',
			grams: 33,
			printer: 'Shop Centauri'
		});
		expect(run.hours).toBe(1);
		expect(partStatus('handle-left')).toBe('Printed');
		expect(buildJobs(db, buildId, 'org1')).toHaveLength(0);
		expect(() => confirmJob(db, j.id, 'org1', 'owner', {})).toThrow(/already logged/);
	});

	it('logs automatically when the team setting is on', () => {
		setOrgSettings(db, 'org1', { autoLogPrints: true });
		updatePlate(db, buildId, 'owner', 1, { slicerGrams: 41 });
		const file = 'TMT-Columbus-Elegoo-plain-plate1.3mf';
		processStatus(db, printerId, printing(file, 10, 600), at(10));
		processStatus(
			db,
			printerId,
			{ state: 'done', progress: 100, fileName: file, elapsedSec: 5400 },
			at(90)
		);
		const run = db.select().from(printRuns).get()!;
		expect(run).toMatchObject({
			plateNumber: 1,
			result: 'Success',
			grams: 41,
			userId: null,
			printer: 'Shop Centauri'
		});
		expect(run.hours).toBe(1.5);
		expect(jobs()[0].runId).toBe(run.id);
		expect(partStatus('handle-left')).toBe('Printed');
		const act = db.select().from(activity).where(eq(activity.kind, 'printer.job.done')).get()!;
		expect(act.userId).toBeNull();
		expect(act.payload).toMatchObject({ auto: true, grams: 41, by: 'Shop Centauri' });
		expect(buildJobs(db, buildId, 'org1')).toHaveLength(0);
	});

	it('never auto-logs a failed or stopped print: it asks', () => {
		setOrgSettings(db, 'org1', { autoLogPrints: true });
		const file = 'Plate 2 - Handle Right.gcode';
		processStatus(db, printerId, printing(file, 20, 600), at(10));
		processStatus(
			db,
			printerId,
			{ state: 'failed', cancelled: true, progress: 22, fileName: file },
			at(20)
		);
		expect(jobs()[0].status).toBe('cancelled');
		expect(db.select().from(printRuns).all()).toHaveLength(0);
		const [pending] = buildJobs(db, buildId, 'org1');
		expect(pending.pendingConfirm).toBe(true);
		dismissJob(db, pending.id, 'org1');
		expect(buildJobs(db, buildId, 'org1')).toHaveLength(0);
		expect(db.select().from(printRuns).all()).toHaveLength(0);
	});

	it('leaves unlinked jobs for a manual link, which also starts the parts', () => {
		processStatus(db, printerId, printing('benchy.gcode', 5, 300), at(5));
		const [j] = jobs();
		expect(j.buildId).toBeNull();
		expect(buildJobs(db, buildId, 'org1').map((x) => x.id)).toEqual([j.id]); // offered for linking
		db.update(printers)
			.set({ lastStatus: printing('benchy.gcode', 5, 300) as never })
			.run();
		linkJob(db, j.id, 'org1', 'owner', buildId, 2);
		expect(jobs()[0]).toMatchObject({ buildId, plateNumber: 2 });
		expect(partStatus('handle-right')).toBe('Printing');
		const view = loadBuildView(db, buildId, 'owner')!;
		expect(view.state['handle-right'].startedAt).toBe(at(0).toISOString());
		expect(view.state['handle-right'].runEstSeconds).toBe(3300);
		expect(
			db.select().from(activity).where(eq(activity.kind, 'printer.job.link')).get()
		).toBeTruthy();
	});

	it('falls back to the build planned for this printer with one plate marked Printing', () => {
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['wing-left'] });
		processStatus(db, printerId, printing('mystery.gcode', 3, 100), at(3));
		expect(jobs()[0]).toMatchObject({ buildId, plateNumber: 6 });
	});

	it('does not guess when two plates are marked Printing', () => {
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['wing-left', 'wing-right'] });
		processStatus(db, printerId, printing('mystery.gcode', 3, 100), at(3));
		expect(jobs()[0].buildId).toBeNull();
	});

	it('a different file ends the previous job; elapsed time starting over is a new run', () => {
		processStatus(db, printerId, printing('a.gcode', 50, 3000), at(50));
		processStatus(db, printerId, printing('b.gcode', 1, 60), at(52));
		expect(
			jobs()
				.map((j) => j.status)
				.sort()
		).toEqual(['cancelled', 'printing']);
		processStatus(db, printerId, printing('b.gcode', 60, 3600), at(112)); // same file, still going: same job
		expect(jobs()).toHaveLength(2);
		processStatus(db, printerId, printing('b.gcode', 1, 30), at(200)); // elapsed started over: new run
		expect(jobs()).toHaveLength(3);
	});

	it('goes idle after a run: counts as done when it was nearly finished', () => {
		processStatus(db, printerId, printing('Plate 1 - Handle Left.gcode', 99, 3000), at(50));
		processStatus(db, printerId, { state: 'idle', progress: null }, at(55));
		expect(jobs()[0].status).toBe('done');
	});

	it('offline does not end a job', () => {
		processStatus(db, printerId, printing('a.gcode', 30, 1000), at(20));
		processStatus(db, printerId, { state: 'offline', progress: null }, at(21));
		expect(jobs()[0].status).toBe('printing');
	});
});

describe('Spoolman-independent log paths', () => {
	it('manual run for the same plate still works', () => {
		expect(() =>
			addRun(db, buildId, 'owner', {
				plateNumber: 1,
				date: '2026-11-03',
				result: 'Success',
				grams: 10
			})
		).not.toThrow();
	});
});

describe('supervisor', () => {
	it('mirrors adapter statuses into the database, throttles writes and feeds the lifecycle', () => {
		const cbs: StatusCallback[] = [];
		let closed = 0;
		const fake: ConnectFn = () => ({
			status$: (cb) => {
				cbs.push(cb);
				return () => {};
			},
			close: () => void closed++
		});
		const events: string[] = [];
		subscribePrinterEvents('org1', (e) => events.push(e.type));
		const sup = new Supervisor(
			db,
			{ 'elegoo-sdcp': fake, moonraker: fake, octoprint: fake, 'bambu-lan': fake },
			60_000
		);
		sup.start();
		expect(sup.size).toBe(1);
		const emit = (s: PrinterStatus) => cbs[0](s);

		emit({ state: 'idle', progress: null });
		let row = db.select().from(printers).get()!;
		expect((row.lastStatus as { state: string }).state).toBe('idle');
		expect(row.lastSeenAt).toBeTruthy();

		emit(printing('Plate 1 - Handle Left.gcode', 1, 60));
		emit(printing('Plate 1 - Handle Left.gcode', 2, 120)); // throttled: same state/file, < 60 s
		row = db.select().from(printers).get()!;
		expect((row.lastStatus as { progress: number }).progress).toBe(1);
		expect(jobs()).toHaveLength(1);
		expect(events.filter((e) => e === 'status')).toHaveLength(3);
		expect(events).toContain('job');

		// Offline is stored but does not move last_seen_at.
		const seen = row.lastSeenAt!.getTime();
		emit({ state: 'offline', progress: null });
		row = db.select().from(printers).get()!;
		expect((row.lastStatus as { state: string }).state).toBe('offline');
		expect(row.lastSeenAt!.getTime()).toBe(seen);

		sup.refresh(printerId);
		expect(closed).toBe(1);
		db.update(printers).set({ enabled: false }).where(eq(printers.id, printerId)).run();
		sup.refresh(printerId);
		expect(sup.size).toBe(0);
		sup.stop();
	});
});

describe('per-part runs (wheel rims: one color per print)', () => {
	const FILE = 'Plate 13 - Wheel Rim.gcode';
	const jobPartSlugs = () => jobs()[0].partSlugs;
	const startUnlinked = () => {
		processStatus(db, printerId, printing('benchy.gcode', 5, 300), at(5));
		db.update(printers)
			.set({ lastStatus: printing('benchy.gcode', 5, 300) as never })
			.run();
		return jobs()[0].id;
	};

	it('auto-link picks one part, not the whole plate', () => {
		processStatus(db, printerId, printing(FILE, 5, 300), at(5));
		expect(jobs()[0]).toMatchObject({ buildId, plateNumber: 13 });
		expect(jobPartSlugs()).toEqual(['rims-1-4']);
		expect(partStatus('rims-1-4')).toBe('Printing');
		expect(partStatus('rims-2-3')).toBe('To print');
	});

	it('auto-link uses the part that is already Printing', () => {
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['rims-2-3'] });
		processStatus(db, printerId, printing(FILE, 5, 300), at(5));
		expect(jobPartSlugs()).toEqual(['rims-2-3']);
		expect(partStatus('rims-1-4')).toBe('To print');
	});

	it('links with chosen partSlugs and rejects bad ones', () => {
		const id = startUnlinked();
		for (const bad of [[], ['handle-left'], ['rims-1-4', 'nope'], 'rims-1-4', [3]])
			expect(() => linkJob(db, id, 'org1', 'owner', buildId, 13, bad)).toThrow(/partSlugs/);
		expect(jobs()[0].buildId).toBeNull();
		linkJob(db, id, 'org1', 'owner', buildId, 13, ['rims-2-3']);
		expect(jobPartSlugs()).toEqual(['rims-2-3']);
		expect(partStatus('rims-2-3')).toBe('Printing');
		expect(partStatus('rims-1-4')).toBe('To print');
	});

	it('changing the parts moves Printing to the new part', () => {
		const id = startUnlinked();
		linkJob(db, id, 'org1', 'owner', buildId, 13, ['rims-2-3']);
		linkJob(db, id, 'org1', 'owner', buildId, 13, ['rims-1-4']);
		expect(jobPartSlugs()).toEqual(['rims-1-4']);
		expect(partStatus('rims-1-4')).toBe('Printing');
		expect(partStatus('rims-2-3')).toBe('To print');
		expect(
			db.select().from(activity).where(eq(activity.kind, 'printer.job.link')).all()
		).toHaveLength(2);
	});

	it('an expectation with partSlugs links the next job to that part', async () => {
		const { setExpected } = await import('../org-settings');
		setExpected(db, 'org1', printerId, {
			buildId,
			plate: 13,
			partSlugs: ['rims-2-3'],
			at: Date.now()
		});
		processStatus(db, printerId, printing('whatever.gcode', 5, 300), at(5));
		expect(jobs()[0]).toMatchObject({ plateNumber: 13 });
		expect(jobPartSlugs()).toEqual(['rims-2-3']);
	});

	it("finish logs a run only for the chosen part, with that part's grams", () => {
		setOrgSettings(db, 'org1', { autoLogPrints: true });
		updatePlate(db, buildId, 'owner', 13, { slicerByPart: { 'rims-1-4': 140, 'rims-2-3': 148 } });
		const id = startUnlinked();
		linkJob(db, id, 'org1', 'owner', buildId, 13, ['rims-2-3']);
		processStatus(
			db,
			printerId,
			{ state: 'done', progress: 100, fileName: 'benchy.gcode', elapsedSec: 7200 },
			at(130)
		);
		const runs = db.select().from(printRuns).all();
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({
			plateNumber: 13,
			partSlug: 'rims-2-3',
			partSlugs: null,
			grams: 148,
			result: 'Success'
		});
		// One of two runs for that part: still Printing; the other part untouched.
		expect(partStatus('rims-2-3')).toBe('Printing');
		expect(partStatus('rims-1-4')).toBe('To print');
	});

	it('dismissing a stopped print puts its parts back from Printing', () => {
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['rims-1-4', 'rims-2-3'] });
		processStatus(db, printerId, printing(FILE, 5, 300), at(5));
		// Both were Printing already; the job covers whatever it linked.
		const covered = jobPartSlugs()!;
		processStatus(
			db,
			printerId,
			{ state: 'failed', cancelled: true, progress: 9, fileName: FILE },
			at(20)
		);
		expect(jobs()[0].status).toBe('cancelled');
		// Not released before the prompt is dismissed (the user may still log it).
		for (const s of covered) expect(partStatus(s)).toBe('Printing');
		dismissJob(db, jobs()[0].id, 'org1', 'owner');
		expect(jobs()[0].runId).toBe('dismissed');
		for (const s of covered) expect(partStatus(s)).toBe('To print');
		expect(
			db.select().from(activity).where(eq(activity.kind, 'printer.job.release')).all()
		).toHaveLength(1);
	});

	it('dismissing keeps parts that another active job still covers', () => {
		const id = startUnlinked();
		linkJob(db, id, 'org1', 'owner', buildId, 13, ['rims-1-4']);
		processStatus(
			db,
			printerId,
			{ state: 'failed', cancelled: true, progress: 9, fileName: 'benchy.gcode' },
			at(20)
		);
		const first = jobs()[0];
		// A second job takes the same part.
		processStatus(db, printerId, printing('b.gcode', 5, 300), at(30));
		const second = jobs().find((j) => j.id !== first.id)!;
		linkJob(db, second.id, 'org1', 'owner', buildId, 13, ['rims-1-4']);
		dismissJob(db, first.id, 'org1', 'owner');
		expect(partStatus('rims-1-4')).toBe('Printing');
	});

	it('confirm logs only the chosen part too', () => {
		updatePlate(db, buildId, 'owner', 13, { slicerByPart: { 'rims-1-4': 140, 'rims-2-3': 148 } });
		processStatus(db, printerId, printing(FILE, 5, 300), at(5));
		processStatus(db, printerId, { state: 'done', progress: 100, fileName: FILE }, at(60));
		confirmJob(db, jobs()[0].id, 'org1', 'owner', {});
		const [run] = db.select().from(printRuns).all();
		expect(run).toMatchObject({ partSlug: 'rims-1-4', grams: 140 });
	});
});
