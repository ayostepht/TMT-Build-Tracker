import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { printerFromCatalog } from '#lib/printers/printer.ts';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import type { PrinterStatus } from '#lib/printers/status.ts';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildParts,
	buildPlates,
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
import { addRun, deleteRun, printingAction, updatePlate } from '../builds/actions';
import { filamentStats } from '#lib/domain/accounting.ts';
import { loadBuildView } from '../builds/view';
import { nowPrinting } from '#lib/domain/now.ts';
import { onBuildEvents } from '../builds/test-helpers';
import { getExpected, setExpected, setOrgSettings } from '../org-settings';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { subscribePrinterEvents } from './bus';
import {
	buildJobs,
	confirmJob,
	dismissJob,
	expectOnPrinterJob,
	linkJob,
	pendingExpected,
	processStatus,
	teamJobs
} from './jobs';
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

	it('never guesses: one plate marked Printing does not attach a job with an unrelated file name', () => {
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['wing-left'] });
		processStatus(db, printerId, printing('mystery.gcode', 3, 100), at(3));
		expect(jobs()[0].buildId).toBeNull();
		expect(partStatus('wing-left')).toBe('Printing');
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
			{ 'elegoo-sdcp': fake, moonraker: fake, octoprint: fake, 'bambu-lan': fake, manual: fake },
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

	it('an expectation with partSlugs becomes a suggestion for that part; confirming links it', () => {
		setExpected(db, 'org1', printerId, {
			buildId,
			plate: 13,
			partSlugs: ['rims-2-3'],
			at: Date.now()
		});
		processStatus(db, printerId, printing('whatever.gcode', 5, 300), at(5));
		expect(jobs()[0].buildId).toBeNull();
		const [exp] = pendingExpected(db, 'org1', buildId);
		expect(exp).toMatchObject({
			printerId,
			plateNumber: 13,
			partSlugs: ['rims-2-3'],
			jobId: jobs()[0].id
		});
		db.update(printers)
			.set({ lastStatus: printing('whatever.gcode', 5, 300) as never })
			.run();
		linkJob(
			db,
			jobs()[0].id,
			'org1',
			'owner',
			buildId,
			exp.plateNumber,
			exp.partSlugs ?? undefined
		);
		expect(jobs()[0]).toMatchObject({ buildId, plateNumber: 13 });
		expect(jobPartSlugs()).toEqual(['rims-2-3']);
		expect(getExpected(db, 'org1', printerId)).toBeNull();
		expect(pendingExpected(db, 'org1', buildId)).toEqual([]);
	});

	it('wheel regression: after a wheel run the next unrelated job is not auto-linked (auto-log on and off)', () => {
		for (const auto of [true, false]) {
			db.delete(printerJobs).run();
			setOrgSettings(db, 'org1', { autoLogPrints: auto });
			processStatus(db, printerId, printing(FILE, 5, 300), at(5));
			expect(jobs()[0]).toMatchObject({ plateNumber: 13 });
			processStatus(
				db,
				printerId,
				{ state: 'done', progress: 100, fileName: FILE, elapsedSec: 7200 },
				at(130)
			);
			// One of two runs for that part: Printing is still set on it (the old fallback keyed on this).
			processStatus(
				db,
				printerId,
				printing('ECC_0.4_tmt_4691_Overture PETG HF_0.2_11h1m.gcode', 2, 100),
				at(200)
			);
			const next = jobs().find((j) => j.fileName.startsWith('ECC_'))!;
			expect(next.buildId, `auto-log ${auto}`).toBeNull();
			expect(next.plateNumber).toBeNull();
			processStatus(db, printerId, { state: 'idle', progress: null }, at(210));
		}
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

	it('a part whose runs are all done, set back to Printing for a job cancelled at 0%, returns to Printed', () => {
		for (const d of ['2026-11-01', '2026-11-02'])
			addRun(db, buildId, 'owner', {
				plateNumber: 13,
				partSlug: 'rims-1-4',
				date: d,
				result: 'Success',
				grams: 100
			});
		expect(partStatus('rims-1-4')).toBe('Printed');
		processStatus(db, printerId, printing('benchy.gcode', 0, 20, { layer: 1 }), at(5));
		db.update(printers)
			.set({ lastStatus: printing('benchy.gcode', 0, 20, { layer: 1 }) as never })
			.run();
		const id = jobs()[0].id;
		linkJob(db, id, 'org1', 'owner', buildId, 13, ['rims-1-4']);
		expect(partStatus('rims-1-4')).toBe('Printing');
		processStatus(
			db,
			printerId,
			{ state: 'failed', cancelled: true, progress: 0, fileName: 'benchy.gcode', layer: 1 },
			at(8)
		);
		expect(jobs()[0].runId).toBe('dismissed');
		expect(partStatus('rims-1-4')).toBe('Printed');
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

describe('suggestions from "Start on printer" and take-off', () => {
	const slicerFile = 'ECC_0.4_tmt_4691_Overture PETG HF_0.2_11h1m.gcode';
	const expectPlate = (plate: number, partSlugs?: string[], jobId?: string) =>
		setExpected(db, 'org1', printerId, {
			buildId,
			plate,
			...(partSlugs ? { partSlugs } : {}),
			...(jobId ? { jobId } : {}),
			at: Date.now()
		});
	const withStatus = (file: string) =>
		db
			.update(printers)
			.set({ lastStatus: printing(file, 5, 300) as never })
			.run();

	it('an expectation does not attach at job creation and is reported pending', () => {
		expectPlate(2);
		processStatus(db, printerId, printing(slicerFile, 1, 30), at(1));
		expect(jobs()[0].buildId).toBeNull();
		expect(partStatus('handle-right')).toBe('To print');
		expect(pendingExpected(db, 'org1', buildId)).toMatchObject([
			{ printerId, buildId, plateNumber: 2, jobId: jobs()[0].id }
		]);
		expect(pendingExpected(db, 'org1', 'other-build')).toEqual([]);
	});

	it('sent while the print already runs: the suggestion is bound to that unlinked job', async () => {
		processStatus(db, printerId, printing(slicerFile, 1, 30), at(1));
		const { expectOnPrinterJob } = await import('./jobs');
		expectOnPrinterJob(db, printerId, { buildId, plate: 2 });
		expect(pendingExpected(db, 'org1', buildId)[0].jobId).toBe(jobs()[0].id);
	});

	it('choosing another plate clears the suggestion', () => {
		expectPlate(2);
		processStatus(db, printerId, printing(slicerFile, 1, 30), at(1));
		withStatus(slicerFile);
		linkJob(db, jobs()[0].id, 'org1', 'owner', buildId, 1);
		expect(jobs()[0]).toMatchObject({ plateNumber: 1 });
		expect(getExpected(db, 'org1', printerId)).toBeNull();
	});

	it('the job event a client reloads on already carries the bound suggestion', () => {
		const seen: { pending: number; jobId: string | null }[] = [];
		expectOnPrinterJob(db, printerId, { buildId, plate: 2 });
		const off = subscribePrinterEvents('org1', (e) => {
			if (e.type !== 'job') return;
			const p = pendingExpected(db, 'org1', buildId);
			seen.push({ pending: p.length, jobId: p[0]?.jobId ?? null });
		});
		processStatus(db, printerId, printing('mystery.gcode', 5, 300), at(5));
		off();
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.every((x) => x.pending === 1 && x.jobId === jobs()[0].id)).toBe(true);
	});
	it('a suggestion never applies to a second job', () => {
		expectPlate(2);
		processStatus(db, printerId, printing(slicerFile, 1, 30), at(1));
		processStatus(db, printerId, { state: 'idle', progress: null }, at(40)); // ended unlinked
		expect(pendingExpected(db, 'org1', buildId)).toEqual([]);
		processStatus(db, printerId, printing('next.gcode', 1, 30), at(60));
		expect(jobs().every((j) => j.buildId === null)).toBe(true);
		expect(pendingExpected(db, 'org1', buildId)).toEqual([]);
	});

	it('a stale suggestion (over 12 h) is ignored and dropped', () => {
		setExpected(db, 'org1', printerId, { buildId, plate: 2, at: Date.now() - 13 * 3600_000 });
		processStatus(db, printerId, printing(slicerFile, 1, 30), at(1));
		expect(pendingExpected(db, 'org1', buildId)).toEqual([]);
		expect(getExpected(db, 'org1', printerId)).toBeNull();
	});

	it('a file name that names the plate still links by itself', () => {
		processStatus(db, printerId, printing('Plate 2 - Handle Right.gcode', 5, 300), at(5));
		expect(jobs()[0]).toMatchObject({ buildId, plateNumber: 2 });
	});

	it('taking a plate off the printer unlinks its live job, logs no run, leaves other plates alone', () => {
		processStatus(db, printerId, printing('Plate 2 - Handle Right.gcode', 5, 300), at(5));
		expect(partStatus('handle-right')).toBe('Printing');
		// stopping a different plate does not touch the job
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['handle-left'] });
		printingAction(db, buildId, 'owner', { action: 'stop', slugs: ['handle-left'] });
		expect(jobs()[0]).toMatchObject({ buildId, plateNumber: 2 });
		const ev = onBuildEvents(buildId);
		printingAction(db, buildId, 'owner', { action: 'stop', slugs: ['handle-right'] });
		expect(jobs()[0]).toMatchObject({ buildId: null, plateNumber: null, partSlugs: null });
		expect(jobs()[0].status).toBe('printing');
		expect(partStatus('handle-right')).toBe('To print');
		expect(db.select().from(printRuns).all()).toHaveLength(0);
		expect(ev.length).toBeGreaterThan(0);
		// the Overview offers it again
		expect(buildJobs(db, buildId, 'org1').map((j) => j.id)).toEqual([jobs()[0].id]);
	});
});

describe('cancelled or failed prints', () => {
	const FILE = 'Plate 1 - Handle Left.gcode';
	const filamentUsed = () =>
		filamentStats(loadBuildView(db, buildId, 'owner')!).reduce((a, f) => a + f.used, 0);
	const stop = (progress: number, extra: Partial<PrinterStatus> = {}, min = 20) =>
		processStatus(
			db,
			printerId,
			{ state: 'failed', cancelled: true, progress, fileName: FILE, ...extra },
			at(min)
		);

	it('cancelled at 0% logs nothing and puts the parts back (auto-log on and off)', () => {
		for (const auto of [true, false]) {
			db.delete(printerJobs).run();
			db.delete(activity).run();
			setOrgSettings(db, 'org1', { autoLogPrints: auto });
			updatePlate(db, buildId, 'owner', 1, { slicerGrams: 41 });
			processStatus(db, printerId, printing(FILE, 0, 20, { layer: 1 }), at(1));
			expect(partStatus('handle-left'), `auto ${auto}`).toBe('Printing');
			stop(0, { layer: 1 }, 3);
			expect(jobs()[0]).toMatchObject({ status: 'cancelled', runId: 'dismissed' });
			expect(db.select().from(printRuns).all()).toHaveLength(0);
			expect(buildJobs(db, buildId, 'org1')).toHaveLength(0);
			expect(partStatus('handle-left')).toBe('To print');
			expect(filamentUsed()).toBe(0);
			const act = db
				.select()
				.from(activity)
				.where(eq(activity.kind, 'printer.job.unstarted'))
				.get()!;
			expect(act.payload).toMatchObject({
				plateNumber: 1,
				result: 'cancelled',
				by: 'Shop Centauri'
			});
		}
	});

	it('cancelled at 40% still asks: nothing logged until confirmed, parts stay Printing', () => {
		setOrgSettings(db, 'org1', { autoLogPrints: true });
		updatePlate(db, buildId, 'owner', 1, { slicerGrams: 41 });
		processStatus(db, printerId, printing(FILE, 40, 1500, { layer: 40 }), at(25));
		stop(40, { layer: 40 });
		expect(db.select().from(printRuns).all()).toHaveLength(0);
		expect(partStatus('handle-left')).toBe('Printing');
		expect(buildJobs(db, buildId, 'org1')[0].pendingConfirm).toBe(true);
		expect(filamentUsed()).toBe(0);
		expect(
			db.select().from(activity).where(eq(activity.kind, 'printer.job.unstarted')).all()
		).toHaveLength(0);
	});

	it('confirming a stopped print defaults to Failed with grams scaled by progress', () => {
		updatePlate(db, buildId, 'owner', 1, { slicerGrams: 41 });
		processStatus(db, printerId, printing(FILE, 40, 1500, { layer: 40 }), at(25));
		stop(40, { layer: 40 });
		confirmJob(db, jobs()[0].id, 'org1', 'owner', {});
		const run = db.select().from(printRuns).get()!;
		expect(run).toMatchObject({ result: 'Failed', grams: 16 });
		expect(partStatus('handle-left')).toBe('Reprint');
		expect(filamentUsed()).toBe(16);
	});

	it('"Don\'t log" (dismiss) at 40% returns the parts to To print and counts nothing', () => {
		processStatus(db, printerId, printing(FILE, 40, 1500, { layer: 40 }), at(25));
		stop(40, { layer: 40 });
		dismissJob(db, jobs()[0].id, 'org1', 'owner');
		expect(partStatus('handle-left')).toBe('To print');
		expect(db.select().from(printRuns).all()).toHaveLength(0);
		expect(filamentUsed()).toBe(0);
	});

	it('is conservative: layers past the first, or nothing known, still ask', () => {
		processStatus(db, printerId, printing(FILE, 0, 20, { layer: 6 }), at(1));
		stop(0, { layer: 6 }, 3);
		expect(buildJobs(db, buildId, 'org1')[0].pendingConfirm).toBe(true);
		dismissJob(db, jobs()[0].id, 'org1', 'owner');
		// no progress, no layer, no elapsed reported on a long job
		processStatus(db, printerId, { state: 'printing', progress: null, fileName: FILE }, at(30));
		processStatus(db, printerId, { state: 'failed', progress: null, fileName: FILE }, at(30 + 120));
		const last = jobs().find((j) => j.status === 'failed')!;
		expect(last.runId).toBeNull();
	});

	it('a multi-run part between runs stays Printing when its next job is cancelled at 0%', () => {
		const RIM = 'Plate 13 - Wheel Rim.gcode';
		processStatus(db, printerId, printing(RIM, 5, 300, { layer: 5 }), at(5));
		processStatus(
			db,
			printerId,
			{ state: 'done', progress: 100, fileName: RIM, elapsedSec: 7200 },
			at(130)
		);
		confirmJob(db, jobs()[0].id, 'org1', 'owner', {});
		expect(partStatus('rims-1-4')).toBe('Printing'); // run 1 of 2 done
		processStatus(db, printerId, printing(RIM, 0, 10, { layer: 1 }), at(200));
		processStatus(
			db,
			printerId,
			{ state: 'failed', cancelled: true, progress: 0, fileName: RIM, layer: 1 },
			at(203)
		);
		expect(partStatus('rims-1-4')).toBe('Printing');
		const st = loadBuildView(db, buildId, 'owner')!.state['rims-1-4'];
		expect(st.startedAt).toBeNull();
		expect(db.select().from(printRuns).all()).toHaveLength(1);
	});

	describe('terminal status that resets progress', () => {
		const terminal = (extra: Partial<PrinterStatus>, min = 40) =>
			processStatus(
				db,
				printerId,
				{ state: 'failed', cancelled: true, fileName: FILE, ...extra } as PrinterStatus,
				at(min)
			);
		const expectAsks = (grams: number) => {
			expect(db.select().from(printRuns).all()).toHaveLength(0);
			expect(partStatus('handle-left')).toBe('Printing');
			expect(buildJobs(db, buildId, 'org1')[0].pendingConfirm).toBe(true);
			expect(jobs()[0].runId).toBeNull();
			confirmJob(db, jobs()[0].id, 'org1', 'owner', {});
			expect(db.select().from(printRuns).get()).toMatchObject({ result: 'Failed', grams });
		};
		beforeEach(() => updatePlate(db, buildId, 'owner', 1, { slicerGrams: 50 }));

		it('40% then a final progress of 0 still asks, scaled from 40%', () => {
			processStatus(db, printerId, printing(FILE, 40, 1500, { layer: 40 }), at(25));
			terminal({ progress: 0, layer: 1 });
			expect(jobs()[0].progress).toBe(40);
			expectAsks(20);
		});
		it('60% with layer info then a final progress of 0 and no layer still asks', () => {
			processStatus(db, printerId, printing(FILE, 60, 2500, { layer: 60 }), at(25));
			terminal({ progress: 0 });
			expectAsks(30);
		});
		it('a final status with no progress at all still asks', () => {
			processStatus(db, printerId, printing(FILE, 40, 1500), at(25));
			terminal({ progress: null });
			expectAsks(20);
			processStatus(db, printerId, printing(FILE, 40, 1500), at(60));
			// (second job is a new run of the same file)
			terminal({ progress: undefined } as Partial<PrinterStatus>, 70);
			expect(jobs()).toHaveLength(2);
		});
		it('the SDCP shape (no layer on the final status) after real progress still asks', () => {
			processStatus(db, printerId, printing(FILE, 12, 600, { layer: 12 }), at(11));
			processStatus(db, printerId, { state: 'failed', cancelled: true, progress: 0 }, at(20));
			// no fileName on the final status: the job is still the active one
			expect(jobs()[0].status).toBe('cancelled');
			expectAsks(6);
		});
		it('polls and a final status at 0 are genuinely not started', () => {
			processStatus(db, printerId, printing(FILE, 0, 20, { layer: 1 }), at(1));
			processStatus(db, printerId, printing(FILE, 0, 40, { layer: 1 }), at(2));
			terminal({ progress: 0, layer: 1 }, 3);
			expect(db.select().from(printRuns).all()).toHaveLength(0);
			expect(partStatus('handle-left')).toBe('To print');
			expect(jobs()[0].runId).toBe('dismissed');
		});
		it('a mid-print poll that dips to 0 does not lower the stored progress', () => {
			processStatus(db, printerId, printing(FILE, 40, 1500, { layer: 40 }), at(25));
			processStatus(db, printerId, printing(FILE, 0, 1560, { layer: 0 }), at(26));
			expect(jobs()[0].progress).toBe(40);
			processStatus(db, printerId, printing(FILE, 45, 1700, { layer: 45 }), at(28));
			expect(jobs()[0].progress).toBe(45);
		});
	});

	it('a Reprint part is a Reprint again after a job cancelled at 0%, and after "Don\'t log" at 40%', () => {
		addRun(db, buildId, 'owner', {
			plateNumber: 1,
			date: '2026-11-03',
			result: 'Failed',
			grams: 5
		});
		expect(partStatus('handle-left')).toBe('Reprint');
		processStatus(db, printerId, printing(FILE, 0, 20, { layer: 1 }), at(1));
		expect(partStatus('handle-left')).toBe('Printing');
		stop(0, { layer: 1 }, 3);
		expect(partStatus('handle-left')).toBe('Reprint');
		expect(loadBuildView(db, buildId, 'owner')!.state['handle-left'].startedAt).toBeNull();

		processStatus(db, printerId, printing(FILE, 40, 1500, { layer: 40 }), at(30));
		expect(partStatus('handle-left')).toBe('Printing');
		stop(40, { layer: 40 }, 50);
		const j = jobs().find((x) => x.runId === null)!;
		dismissJob(db, j.id, 'org1', 'owner');
		expect(partStatus('handle-left')).toBe('Reprint');
	});

	it('deleting a failed run of a multi-run plate restores statuses and filament', () => {
		updatePlate(db, buildId, 'owner', 13, { slicerByPart: { 'rims-1-4': 140, 'rims-2-3': 148 } });
		addRun(db, buildId, 'owner', {
			plateNumber: 13,
			partSlug: 'rims-1-4',
			date: '2026-11-03',
			result: 'Success',
			grams: 140
		});
		const failed = addRun(db, buildId, 'owner', {
			plateNumber: 13,
			partSlug: 'rims-1-4',
			date: '2026-11-04',
			result: 'Failed',
			grams: 60
		});
		expect(partStatus('rims-1-4')).toBe('Reprint');
		expect(filamentUsed()).toBe(200);
		deleteRun(db, buildId, 'owner', failed);
		expect(db.select().from(printRuns).all()).toHaveLength(1);
		expect(partStatus('rims-1-4')).toBe('To print'); // run 1 of 2 won; not Printing now
		expect(filamentUsed()).toBe(140);
	});
});

describe('team job history keeps unlinked prints apart', () => {
	it('never sends unlinked finished jobs to a build, and returns them separately for the team', () => {
		processStatus(db, printerId, printing('Plate 1 - Handle Left.gcode', 5, 300), at(5));
		processStatus(
			db,
			printerId,
			{ state: 'done', progress: 100, fileName: 'Plate 1 - Handle Left.gcode' },
			at(60)
		);
		processStatus(db, printerId, printing('benchy.gcode', 5, 300), at(70));
		processStatus(
			db,
			printerId,
			{ state: 'failed', cancelled: true, progress: 3, fileName: 'benchy.gcode' },
			at(80)
		);
		processStatus(db, printerId, printing('vase.gcode', 5, 300), at(90));
		const all = jobs();
		const bench = all.find((j) => j.fileName === 'benchy.gcode')!;
		const vase = all.find((j) => j.fileName === 'vase.gcode')!;
		expect(bench.buildId).toBeNull();
		expect(bench.status).toBe('cancelled');
		// Build view: the linked job (waiting for its log) and the running unlinked one, never the finished unlinked one.
		const ids = buildJobs(db, buildId, 'org1').map((j) => j.id);
		expect(ids).toContain(vase.id);
		expect(ids).not.toContain(bench.id);
		// Team view still returns it (the Printers page puts it behind a disclosure).
		expect(teamJobs(db, 'org1').map((j) => j.id)).toContain(bench.id);
		// Nothing of another team.
		expect(teamJobs(db, 'other-org')).toHaveLength(0);
		// No activity rows mention the unlinked jobs.
		expect(JSON.stringify(db.select().from(activity).all())).not.toContain('benchy');
	});

	it('a flood of unlinked jobs does not push linked ones out of the list', () => {
		processStatus(db, printerId, printing('Plate 1 - Handle Left.gcode', 5, 300), at(5));
		processStatus(db, printerId, { state: 'idle', progress: 100 } as PrinterStatus, at(30));
		for (let i = 0; i < 20; i++) {
			processStatus(db, printerId, printing(`junk${i}.gcode`, 5, 300), at(100 + i * 10));
			processStatus(
				db,
				printerId,
				{ state: 'idle', progress: 0 } as PrinterStatus,
				at(105 + i * 10)
			);
		}
		const t = teamJobs(db, 'org1');
		expect(t.some((j) => j.buildId === buildId)).toBe(true);
	});
});

describe('linking a job over parts that are already Printing', () => {
	const FILE_A = 'Plate 1 - Handle Left.gcode';
	const FILE_B = 'slice_b_17h44m.gcode'; // another slice: no plate match, linked by hand
	const view = () => loadBuildView(db, buildId, 'owner')!;
	const plateEst = () =>
		db.select().from(buildPlates).where(eq(buildPlates.number, 1)).get()!.manualEstSeconds;
	const link = (jobId: string, st: PrinterStatus) => {
		db.update(printers)
			.set({ lastStatus: st as never })
			.run();
		linkJob(db, jobId, 'org1', 'owner', buildId, 1);
	};
	/** Job A (linked by file name, est 4500 s, started at(0)) ends cancelled at 39%, unlogged. */
	const cancelledA = () => {
		processStatus(db, printerId, printing(FILE_A, 20, 1500, { remainingSec: 3000 }), at(25));
		processStatus(
			db,
			printerId,
			{ state: 'failed', cancelled: true, progress: 39, fileName: FILE_A, layer: 40 },
			at(35)
		);
		const a = jobs().find((j) => j.fileName === FILE_A)!;
		expect(a.status).toBe('cancelled');
		expect(partStatus('handle-left')).toBe('Printing');
		expect(plateEst()).toBe(4500);
		return a;
	};
	/** Job B starts at(40) (elapsed 100 s), total 7100 s, unlinked until the user links it. */
	const startB = () => {
		const st = printing(FILE_B, 1, 100, { remainingSec: 7000 });
		processStatus(db, printerId, st, at(40));
		const b = jobs().find((j) => j.fileName === FILE_B)!;
		expect(b.buildId).toBeNull();
		return { b, st };
	};

	it('takes the new job start and estimate over an ended, unlogged job', () => {
		cancelledA();
		const { b, st } = startB();
		link(b.id, st);
		const p = view().state['handle-left'];
		expect(p.status).toBe('Printing');
		expect(p.startedAt).toBe(b.startedAt!.toISOString());
		expect(p.startedAt).not.toBe(at(0).toISOString());
		expect(p.runEstSeconds).toBe(7100);
		expect(plateEst()).toBe(7100);
	});

	it('confirming the old job as Failed or Partial keeps the plate printing on the new job', () => {
		for (const result of ['Failed', 'Partial'] as const) {
			db.delete(printRuns).run();
			db.delete(printerJobs).run();
			db.update(buildParts).set({ status: 'To print', startedAt: null, runEstSeconds: null }).run();
			const a = cancelledA();
			const { b, st } = startB();
			link(b.id, st);
			const runId = confirmJob(db, a.id, 'org1', 'owner', { result });
			expect(jobs().find((j) => j.id === a.id)!.runId).toBe(runId);
			expect(db.select().from(printRuns).get()).toMatchObject({ id: runId, result });
			const p = view().state['handle-left'];
			expect(p.status, result).toBe('Printing');
			expect(p.startedAt).toBe(b.startedAt!.toISOString());
			expect(p.runEstSeconds).toBe(7100);
			// the Overview's "Now printing" card (domain nowPrinting over the build view)
			const card = nowPrinting(view()).find((c) => c.plate === 1);
			expect(card, result).toBeTruthy();
			expect(card!.startedAt).toBe(b.startedAt!.toISOString());
		}
	});

	it('a manual start at now, then a job that started earlier: the job start wins', () => {
		printingAction(db, buildId, 'owner', { action: 'start', slugs: ['handle-left'] });
		expect(view().state['handle-left'].startedAt).toBeTruthy();
		const st = printing(FILE_B, 10, 900, { remainingSec: 6000 });
		processStatus(db, printerId, st, new Date());
		const b = jobs().find((j) => j.fileName === FILE_B)!;
		link(b.id, st);
		const p = view().state['handle-left'];
		expect(p.startedAt).toBe(b.startedAt!.toISOString());
		expect(p.runEstSeconds).toBe(6900);
		expect(plateEst()).toBe(6900);
	});

	it('keeps the start and estimate when another running job already covers the parts', () => {
		// job A running and linked by file name on printer 1
		processStatus(db, printerId, printing(FILE_A, 20, 1500, { remainingSec: 3000 }), at(25));
		const before = view().state['handle-left'];
		expect(before.startedAt).toBe(at(0).toISOString());
		// a second printer runs another file; the user links it to the same plate
		const p2 = createPrinter(db, 'org1', 'owner', {
			name: 'Second',
			kind: 'elegoo-sdcp',
			host: '10.0.0.10',
			catalogId: 'elegoo-centauri-carbon'
		}).id;
		const st = printing(FILE_B, 5, 200, { remainingSec: 9000 });
		processStatus(db, p2, st, at(30));
		const b = jobs().find((j) => j.fileName === FILE_B)!;
		db.update(printers)
			.set({ lastStatus: st as never })
			.where(eq(printers.id, p2))
			.run();
		linkJob(db, b.id, 'org1', 'owner', buildId, 1);
		const after = view().state['handle-left'];
		expect(after.startedAt).toBe(before.startedAt);
		expect(after.runEstSeconds).toBe(4500);
	});

	it('does not overwrite a plate time the user typed', () => {
		cancelledA();
		db.update(buildPlates)
			.set({ manualEstSeconds: 6000, manualEstSource: 'user' })
			.where(eq(buildPlates.number, 1))
			.run();
		const { b, st } = startB();
		link(b.id, st);
		expect(plateEst()).toBe(6000);
		expect(view().state['handle-left'].runEstSeconds).toBe(7100);
	});
});
