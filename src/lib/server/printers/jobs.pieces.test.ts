/**
 * "Print some pieces…" on a printer: an expectation and a job link that carry `comps` (pieces of the
 * job's single part), the finished job's log of exactly those pieces, and the validation of every
 * request field. Harness and Straps (9 pieces) sits alone on plate 18.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ApiError } from '../access';
import { printerFromCatalog } from '#lib/printers/printer.ts';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import type { PrinterStatus } from '#lib/printers/status.ts';
import { openDb, runMigrations, type Db } from '../db';
import {
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
import { printingAction, setPartStatus, updatePart } from '../builds/actions';
import { loadBuildView } from '../builds/view';
import { getExpected, setOrgSettings } from '../org-settings';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { plateRunGrams } from '#lib/domain/printer-match.ts';
import {
	checkPieces,
	confirmJobRuns,
	dismissJob,
	expectOnPrinterJob,
	linkJob,
	pendingExpected,
	processStatus,
	toJobView,
	unlinkJob
} from './jobs';
import { createPrinter } from './store';

const H = 'harness';
let db: Db;
let buildId: string;
let printerId: string;
const T0 = new Date('2026-11-03T10:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const printing = (progress: number, elapsedSec: number): PrinterStatus => ({
	state: 'printing',
	progress,
	fileName: 'whatever.gcode',
	elapsedSec,
	remainingSec: 3000,
	layer: 10,
	totalLayers: 100
});
const jobs = () => db.select().from(printerJobs).all();
const view = () => loadBuildView(db, buildId, 'owner')!;
const runs = () => db.select().from(printRuns).where(eq(printRuns.buildId, buildId)).all();
const ticked = () =>
	Object.entries(view().state[H].comps)
		.filter(([, v]) => v)
		.map(([k]) => Number(k))
		.sort((a, b) => a - b);
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as ApiError).status;
	}
	return 0;
};
/** The job is running and the printer's last status is stored (what a manual link reads). */
const startJob = (progress = 5, elapsed = 300) => {
	processStatus(db, printerId, printing(progress, elapsed), at(5));
	db.update(printers)
		.set({ lastStatus: printing(progress, elapsed) as never })
		.run();
	return jobs()[0].id;
};
const finish = (state: 'done' | 'failed', progress: number) =>
	processStatus(db, printerId, { state, progress, fileName: 'whatever.gcode', layer: 50 }, at(65));

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	db.insert(user).values({ id: 'owner', name: 'Olive', email: 'o@example.test' }).run();
	db.insert(user).values({ id: 'viewer', name: 'Vic', email: 'v@example.test' }).run();
	db.insert(organization)
		.values({ id: 'org1', name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	for (const [id, role] of [
		['owner', 'owner'],
		['viewer', 'viewer']
	])
		db.insert(member)
			.values({ id: `m-${id}`, organizationId: 'org1', userId: id, role, createdAt: new Date() })
			.run();
	const templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	buildId = createBuild(
		db,
		{ organizationId: 'org1', templateId, designId: null, name: 'Columbus' },
		'owner'
	);
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

const link = (jobId: string, comps?: unknown, slugs: unknown = [H]) =>
	linkJob(db, jobId, 'org1', 'owner', buildId, 18, slugs, comps);

describe('expectation with pieces', () => {
	it('is stored, bound to the running job, reported with comps and links with them', () => {
		const jobId = startJob();
		// The client marks the pieces first (start with comps), then sends the expectation.
		printingAction(db, buildId, 'owner', {
			action: 'start',
			slugs: [H],
			comps: [0, 1, 4],
			printer: 'Shop Centauri'
		});
		expectOnPrinterJob(db, printerId, { buildId, plate: 18, partSlugs: [H], comps: [0, 1, 4] });
		expect(getExpected(db, 'org1', printerId)).toMatchObject({ comps: [0, 1, 4], jobId });
		const [exp] = pendingExpected(db, 'org1', buildId);
		expect(exp).toMatchObject({ plateNumber: 18, partSlugs: [H], comps: [0, 1, 4], jobId });
		link(exp.jobId, exp.comps ?? undefined, exp.partSlugs);
		expect(jobs()[0]).toMatchObject({ buildId, plateNumber: 18, partSlugs: [H], comps: [0, 1, 4] });
		expect(view().state[H]).toMatchObject({ status: 'Printing', printingComps: [0, 1, 4] });
		expect(getExpected(db, 'org1', printerId)).toBeNull();
		expect(toJobView(jobs()[0], 'Shop Centauri').comps).toEqual([0, 1, 4]);
	});
	it('a whole-part expectation has no comps', () => {
		startJob();
		expectOnPrinterJob(db, printerId, { buildId, plate: 18, partSlugs: [H] });
		expect(pendingExpected(db, 'org1', buildId)[0].comps).toBeNull();
	});
});

describe('linking a job with pieces', () => {
	it('marks the part Printing with just those pieces, the job start and estimate on the part', () => {
		const jobId = startJob();
		link(jobId, [2, 0]);
		expect(jobs()[0].comps).toEqual([0, 2]);
		const st = view().state[H];
		expect(st).toMatchObject({ status: 'Printing', printingComps: [0, 2] });
		expect(st.startedAt).toBeTruthy();
		expect(st.runEstSeconds).toBeGreaterThan(0);
		// the printer's time is that of some pieces: it never becomes the plate's own time
		const plate = db
			.select()
			.from(buildPlates)
			.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.number, 18)))
			.get()!;
		expect(plate.manualEstSeconds).toBeNull();
	});
	it('a piece print marked first and then linked by hand keeps its pieces', () => {
		printingAction(db, buildId, 'owner', { action: 'start', slugs: [H], comps: [1, 3] });
		link(startJob(), undefined);
		expect(jobs()[0].comps).toEqual([1, 3]);
		expect(view().state[H].printingComps).toEqual([1, 3]);
	});
	it('re-linking with other pieces changes the list on the part too', () => {
		const jobId = startJob();
		link(jobId, [0, 1]);
		link(jobId, [2, 3, 4]);
		expect(jobs()[0].comps).toEqual([2, 3, 4]);
		expect(view().state[H].printingComps).toEqual([2, 3, 4]);
	});
	it('every piece still to print is a whole-part link', () => {
		updatePart(db, buildId, 'owner', H, { comps: { '0': true } });
		link(startJob(), [1, 2, 3, 4, 5, 6, 7, 8]);
		expect(jobs()[0].comps).toBeNull();
		expect(view().state[H].printingComps ?? null).toBeNull();
	});
	it('a whole-part job is unchanged: no comps anywhere', () => {
		link(startJob());
		expect(jobs()[0]).toMatchObject({ buildId, partSlugs: [H], comps: null });
		expect(view().state[H]).toMatchObject({ status: 'Printing' });
		expect(view().state[H].printingComps ?? null).toBeNull();
	});
	it('unlinking clears the job pieces (the part stays on the printer with its list)', () => {
		const jobId = startJob();
		link(jobId, [0, 1]);
		unlinkJob(db, jobId, 'org1');
		expect(jobs()[0]).toMatchObject({ buildId: null, partSlugs: null, comps: null });
		expect(view().state[H]).toMatchObject({ status: 'Printing', printingComps: [0, 1] });
	});
});

describe('finishing a piece job', () => {
	const arrange = (comps = [0, 1, 2]) => {
		const jobId = startJob();
		link(jobId, comps);
		return jobId;
	};
	it('Confirm print log logs a run of exactly those pieces and ticks only them', async () => {
		const jobId = arrange();
		finish('done', 100);
		const r = confirmJobRuns(db, jobId, 'org1', 'owner', { result: 'Success' });
		expect(runs()).toHaveLength(1);
		expect(runs()[0]).toMatchObject({
			partSlug: H,
			partSlugs: null,
			comps: [0, 1, 2],
			plateNumber: 18,
			result: 'Success'
		});
		expect(r.runIds).toHaveLength(1);
		expect(ticked()).toEqual([0, 1, 2]);
		expect(view().state[H]).toMatchObject({ status: 'To print', printingComps: null });
	});
	it('the last pieces make the part Printed', () => {
		const jobId = arrange();
		updatePart(db, buildId, 'owner', H, {
			comps: Object.fromEntries([3, 4, 5, 6, 7, 8].map((i) => [String(i), true]))
		});
		finish('done', 100);
		confirmJobRuns(db, jobId, 'org1', 'owner', {});
		expect(ticked()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
		expect(view().state[H].status).toBe('Printed');
	});
	it('logs automatically with the team setting, still only those pieces', () => {
		setOrgSettings(db, 'org1', { autoLogPrints: true } as never);
		arrange([5, 6]);
		finish('done', 100);
		expect(runs()).toHaveLength(1);
		expect(runs()[0]).toMatchObject({ comps: [5, 6], partSlug: H, partSlugs: null });
		expect(ticked()).toEqual([5, 6]);
	});
	it("the grams are the pieces' share, not the whole part", () => {
		const whole = plateRunGrams(view(), 18, [H]);
		arrange([0, 1, 2]);
		const share = plateRunGrams(view(), 18, [H]);
		expect(whole).toBeGreaterThan(0);
		expect(share).toBeCloseTo(whole! / 3, 5);
	});
	it('a failed job logs Failed with the pieces: nothing is ticked', () => {
		const jobId = arrange();
		finish('failed', 40);
		confirmJobRuns(db, jobId, 'org1', 'owner', {});
		expect(runs()[0]).toMatchObject({ result: 'Failed', comps: [0, 1, 2] });
		expect(ticked()).toEqual([]);
		expect(view().state[H].printingComps ?? null).toBeNull();
	});
	it('a cancelled job ticks nothing; "Don\'t log" returns the part with no list', () => {
		const jobId = arrange();
		processStatus(
			db,
			printerId,
			{ state: 'idle', progress: null, fileName: '', layer: 50 },
			at(40)
		);
		expect(jobs()[0].status).toBe('cancelled');
		dismissJob(db, jobId, 'org1', 'owner');
		expect(runs()).toHaveLength(0);
		expect(ticked()).toEqual([]);
		expect(view().state[H]).toMatchObject({ status: 'To print', printingComps: null });
	});
	it('a job cancelled at 0% logs nothing and releases the part', () => {
		const early = (state: PrinterStatus['state']): PrinterStatus => ({
			state,
			progress: 0,
			fileName: state === 'idle' ? '' : 'whatever.gcode',
			elapsedSec: 30,
			layer: 1
		});
		processStatus(db, printerId, early('printing'), at(5));
		link(jobs()[0].id, [0, 1, 2]);
		processStatus(db, printerId, early('idle'), at(6));
		expect(runs()).toHaveLength(0);
		expect(view().state[H]).toMatchObject({ status: 'To print', printingComps: null });
	});
	it('Partial (or a split) for a piece job is refused', () => {
		const jobId = arrange();
		finish('done', 100);
		expect(code(() => confirmJobRuns(db, jobId, 'org1', 'owner', { result: 'Partial' }))).toBe(400);
		expect(
			code(() =>
				confirmJobRuns(db, jobId, 'org1', 'owner', {
					result: 'Success',
					split: { keptSlugs: [H], keptGrams: 1, lostGrams: 1 }
				})
			)
		).toBe(400);
		expect(runs()).toHaveLength(0);
	});
});

describe('validation', () => {
	const jobId = () => startJob();
	it.each([
		['out of range', [0, 9]],
		['negative', [-1, 0]],
		['not a whole number', [0.5, 1]],
		['not a number', ['0', 1]],
		['listed twice', [1, 1]],
		['empty', []],
		['not a list', 'all'],
		['every piece of the part', [0, 1, 2, 3, 4, 5, 6, 7, 8]]
	])('refuses pieces that are %s', (_n, comps) => {
		const id = jobId();
		expect(code(() => link(id, comps))).toBe(400);
		expect(code(() => checkPieces(view(), 18, [H], comps))).toBe(400);
		expect(code(() => expectOnPrinterJob(db, printerId, { buildId, plate: 18 }))).toBe(0);
		expect(jobs()[0]).toMatchObject({ buildId: null, comps: null });
	});
	it('refuses a list that is too long', () => {
		expect(
			code(() =>
				checkPieces(
					view(),
					18,
					[H],
					Array.from({ length: 300 }, (_, i) => i)
				)
			)
		).toBe(400);
	});
	it('refuses a piece that is already ticked', () => {
		updatePart(db, buildId, 'owner', H, { comps: { '2': true } });
		expect(code(() => link(jobId(), [1, 2]))).toBe(400);
	});
	it('refuses pieces without exactly one part', () => {
		const id = jobId();
		expect(code(() => link(id, [0, 1], null))).toBe(400);
		expect(code(() => link(id, [0, 1], [H, 'handle-left']))).toBe(400);
		expect(code(() => checkPieces(view(), 18, [H, 'x'], [0]))).toBe(400);
	});
	it('refuses a part with no separate pieces', () => {
		const other = view().parts.find((p) => p.components.length < 2)!;
		const plate = view().plates.find((p) => p.parts.includes(other.slug))!;
		expect(code(() => checkPieces(view(), plate.number, [other.slug], [0]))).toBe(400);
	});
	it('refuses a plate that prints more than once or one part per run', () => {
		for (const set of [{ runs: 2 }, { perPartRuns: true }]) {
			db.update(buildPlates)
				.set(set)
				.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.number, 18)))
				.run();
			expect(
				code(() => checkPieces(view(), 18, [H], [0, 1])),
				JSON.stringify(set)
			).toBe(400);
			db.update(buildPlates)
				.set({ runs: 1, perPartRuns: false })
				.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.number, 18)))
				.run();
		}
	});
	it('refuses a part that is already Printed', () => {
		setPartStatus(db, buildId, 'owner', H, { status: 'Printed' });
		expect(code(() => checkPieces(view(), 18, [H], [0, 1]))).toBe(400);
	});
	it('stays out of a draft and a viewer (the link and expect guards are unchanged)', () => {
		const templateId = db.select({ id: templates.id }).from(templates).get()!.id;
		const draft = createBuild(
			db,
			{ organizationId: 'org1', templateId, designId: null, name: 'D', kind: 'draft' },
			'owner'
		);
		expect(code(() => linkJob(db, startJob(), 'org1', 'owner', draft, 18, [H], [0, 1]))).toBe(400);
		expect(jobs()[0].comps).toBeNull();
	});
});
