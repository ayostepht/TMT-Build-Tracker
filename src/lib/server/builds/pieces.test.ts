/**
 * "Print some pieces…" on the server: starting a piece print (`printing` start with `comps`), logging
 * one (`runs` with `comps`), undo, edit and delete, hand ticks and Stop, plus the validation: every
 * request field is checked on the server, for editors only, never on drafts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildPlates,
	member,
	organization,
	printerJobs,
	printRuns,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import {
	addRun,
	deleteRun,
	printingAction,
	setPartStatus,
	undoRun,
	updatePart,
	updateRun
} from './actions';
import { createBuild } from './create';
import { createPrinter } from '../printers/store';
import { loadBuildView } from './view';
import { describeActivity } from '../../domain/activity';
import { snapshotParts } from '../../domain/logrun';
import { filamentStats, timeStats } from '../../domain/accounting';
import { nowPrinting } from '../../domain/now';

let db: Db;
let templateId: string;
const orgId = 'org1';
const H = 'harness';

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	for (const u of ['owner', 'editor', 'viewer']) {
		db.insert(user)
			.values({ id: u, name: `User ${u}`, email: `${u}@example.test` })
			.run();
		db.insert(member)
			.values({ id: `m-${u}`, organizationId: orgId, userId: u, role: u, createdAt: new Date() })
			.run();
	}
});

const mk = (kind: 'build' | 'draft' = 'build') =>
	createBuild(db, { organizationId: orgId, templateId, designId: null, name: 'B', kind }, 'owner');
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const acts = (id: string, kind: string) =>
	db
		.select()
		.from(activity)
		.where(eq(activity.buildId, id))
		.all()
		.filter((a) => a.kind === kind);
const status = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as ApiError).status;
	}
	return 0;
};
const ticked = (id: string) =>
	Object.entries(view(id).state[H].comps)
		.filter(([, v]) => v)
		.map(([k]) => Number(k))
		.sort((a, b) => a - b);
const start = (id: string, comps?: unknown, extra: object = {}) =>
	printingAction(db, id, 'owner', {
		action: 'start',
		slugs: [H],
		...(comps ? { comps } : {}),
		...extra
	});
const logPieces = (id: string, comps: unknown, result = 'Success', over: object = {}) =>
	addRun(db, id, 'owner', {
		plateNumber: 18,
		partSlug: H,
		comps,
		date: '2026-01-02',
		result,
		hours: 1,
		grams: 80,
		note: '',
		...over
	});

describe('starting some pieces', () => {
	it('marks the part Printing with the picked pieces and writes the activity row', () => {
		const id = mk();
		start(id, [4, 0, 2]);
		const v = view(id);
		expect(v.state[H]).toMatchObject({ status: 'Printing', printingComps: [0, 2, 4] });
		const row = acts(id, 'printing.start').at(-1)!;
		expect(row.payload).toMatchObject({ slugs: [H], comps: [0, 2, 4] });
		expect(describeActivity({ ...row, at: row.at.toISOString(), userName: 'Sam' }, v)).toBe(
			'Sam put 3 pieces of Harness and Straps on the printer'
		);
		const [card] = nowPrinting(v);
		expect(card.pieces[0].picked).toHaveLength(3);
		expect(card.subset).toBe(true);
	});
	it('a typed start time and estimate keep working', () => {
		const id = mk();
		start(id, [0, 1, 2]);
		printingAction(db, id, 'owner', {
			action: 'setStart',
			slugs: [H],
			when: '2026-01-02T08:00:00.000Z'
		});
		printingAction(db, id, 'owner', { action: 'setEstimate', slugs: [H], seconds: 9000 });
		expect(view(id).state[H]).toMatchObject({
			printingComps: [0, 1, 2],
			startedAt: '2026-01-02T08:00:00.000Z',
			runEstSeconds: 9000
		});
	});
	it('every piece still to print is the whole-part print: no piece list, no comps in the row', () => {
		const id = mk();
		updatePart(db, id, 'owner', H, { comps: { '0': true } });
		start(id, [1, 2, 3, 4, 5, 6, 7, 8]);
		expect(view(id).state[H]).toMatchObject({ status: 'Printing', printingComps: null });
		expect(acts(id, 'printing.start').at(-1)!.payload).not.toHaveProperty('comps');
	});
	it('refuses what is not a valid piece print, with 400', () => {
		const id = mk();
		const cases: [string, unknown, object?][] = [
			['not a list', 'abc'],
			['empty', []],
			['a duplicate', [1, 1]],
			['out of range', [9]],
			['negative', [-1]],
			['a fraction', [0.5]],
			['a string', ['1']],
			['an object', [{}]],
			['all of them', [0, 1, 2, 3, 4, 5, 6, 7, 8]],
			['too many', Array.from({ length: 300 }, (_, i) => i)]
		];
		for (const [name, comps] of cases) {
			expect(
				status(() => start(id, comps)),
				name
			).toBe(400);
		}
		expect(view(id).state[H].status).toBe('To print');
		// two parts, or an unknown / prototype slug
		expect(
			status(() =>
				printingAction(db, id, 'owner', { action: 'start', slugs: [H, 'connectors'], comps: [0] })
			)
		).toBe(400);
		expect(
			status(() =>
				printingAction(db, id, 'owner', { action: 'start', slugs: ['constructor'], comps: [0] })
			)
		).toBe(400);
		// a part with no separate pieces
		const plain = view(id).parts.find((p) => !p.components.length)!.slug;
		expect(
			status(() => printingAction(db, id, 'owner', { action: 'start', slugs: [plain], comps: [0] }))
		).toBe(400);
		// a ticked piece
		updatePart(db, id, 'owner', H, { comps: { '2': true } });
		expect(status(() => start(id, [1, 2]))).toBe(400);
		expect(view(id).state[H].printingComps ?? null).toBeNull();
	});
	it('refuses a part already on the printer or already printed', () => {
		const id = mk();
		start(id, [0, 1]);
		expect(status(() => start(id, [2, 3]))).toBe(400);
		expect(view(id).state[H].printingComps).toEqual([0, 1]);
		setPartStatus(db, id, 'owner', H, { status: 'Printed' });
		expect(status(() => start(id, [2, 3]))).toBe(400);
	});
	it('refuses a plate that prints more than once or one part per run', () => {
		for (const set of [{ runs: 2 }, { perPartRuns: true }]) {
			const id = mk();
			db.update(buildPlates)
				.set(set)
				.where(and(eq(buildPlates.buildId, id), eq(buildPlates.number, 18)))
				.run();
			expect(
				status(() => start(id, [0, 1])),
				JSON.stringify(set)
			).toBe(400);
			expect(
				status(() => logPieces(id, [0, 1])),
				JSON.stringify(set)
			).toBe(400);
			expect(view(id).state[H].status).toBe('To print');
			expect(view(id).runs).toHaveLength(0);
		}
	});
	it('viewers cannot, and a draft has no printing', () => {
		const id = mk();
		expect(
			status(() => printingAction(db, id, 'viewer', { action: 'start', slugs: [H], comps: [0, 1] }))
		).toBe(403);
		const draft = mk('draft');
		expect(status(() => start(draft, [0, 1]))).toBe(400);
		expect(status(() => logPieces(draft, [0, 1]))).toBe(400);
		expect(view(draft).state[H].printingComps ?? null).toBeNull();
	});
	it('Take off printer clears the piece list', () => {
		const id = mk();
		start(id, [0, 1, 2]);
		printingAction(db, id, 'owner', { action: 'stop', slugs: [H] });
		expect(view(id).state[H]).toMatchObject({ status: 'To print', printingComps: null });
	});
	it('Take off printer also unlinks a live job and drops its piece list', () => {
		const id = mk();
		const printerId = createPrinter(db, orgId, 'owner', {
			name: 'Shop Centauri',
			kind: 'elegoo-sdcp',
			host: '10.0.0.9',
			catalogId: 'elegoo-centauri-carbon'
		}).id;
		start(id, [0, 1, 2]);
		db.insert(printerJobs)
			.values({
				printerId,
				buildId: id,
				plateNumber: 18,
				partSlugs: [H],
				comps: [0, 1, 2],
				status: 'printing',
				startedAt: new Date()
			})
			.run();
		printingAction(db, id, 'owner', { action: 'stop', slugs: [H] });
		expect(db.select().from(printerJobs).get()).toMatchObject({
			buildId: null,
			plateNumber: null,
			partSlugs: null,
			comps: null
		});
		expect(view(id).state[H]).toMatchObject({ status: 'To print', printingComps: null });
	});
	it('a status set by hand clears the piece list', () => {
		const id = mk();
		start(id, [0, 1, 2]);
		setPartStatus(db, id, 'owner', H, { status: 'Reprint' });
		expect(view(id).state[H]).toMatchObject({ status: 'Reprint', printingComps: null });
	});
});

describe('logging a piece print', () => {
	it('Success ticks those pieces; the part goes back to To print and the log stores them', () => {
		const id = mk();
		start(id, [0, 1, 2]);
		const { runId } = logPieces(id, [2, 1, 0]);
		const v = view(id);
		expect(v.state[H]).toMatchObject({ status: 'To print', printingComps: null, startedAt: null });
		expect(ticked(id)).toEqual([0, 1, 2]);
		const r = v.runs.find((x) => x.id === runId)!;
		expect(r).toMatchObject({ partSlug: H, plateNumber: 18, comps: [0, 1, 2], result: 'Success' });
		expect(nowPrinting(v)).toEqual([]);
		const row = acts(id, 'run.add').at(-1)!;
		expect(describeActivity({ ...row, at: row.at.toISOString(), userName: 'Sam' }, v)).toBe(
			'Sam logged a successful print of 3 pieces of Harness and Straps (plate 18) (80 g)'
		);
	});
	it('the run that ticks the last pieces prints the part', () => {
		const id = mk();
		logPieces(id, [0, 1, 2, 3]);
		logPieces(id, [4, 5, 6, 7, 8], 'Success', { date: '2026-01-03' });
		expect(view(id).state[H]).toMatchObject({ status: 'Printed', printedOn: '2026-01-03' });
		expect(ticked(id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
	});
	it('Failed ticks nothing and flags Reprint', () => {
		const id = mk();
		start(id, [0, 1, 2]);
		logPieces(id, [0, 1, 2], 'Failed', { grams: 30 });
		expect(view(id).state[H]).toMatchObject({ status: 'Reprint', printingComps: null });
		expect(ticked(id)).toEqual([]);
		const f = filamentStats(view(id)).find((x) => x.lostG > 0)!;
		expect(f.lostG).toBe(30);
	});
	it('works as a part log with no plate', () => {
		const id = mk();
		addRun(db, id, 'owner', { partSlug: H, comps: [0, 1], date: '2026-01-02', result: 'Success' });
		expect(ticked(id)).toEqual([0, 1]);
	});
	it('a piece run is not a plate run: the plate time and pace are untouched', () => {
		const id = mk();
		const before = timeStats(view(id));
		logPieces(id, [0, 1, 2]);
		const after = timeStats(view(id));
		expect(after.totalSec).toBe(before.totalSec);
		// a third of the pieces are ticked: a third of the plate's time is done
		expect(after.leftSec).toBeCloseTo(
			before.leftSec - view(id).plates.find((p) => p.number === 18)!.estSeconds! / 3,
			3
		);
		expect(after.paceRatio).toBeNull();
	});
	it('refuses what is not a valid piece log, with 400', () => {
		const id = mk();
		const bad: [string, object][] = [
			['no part', { partSlug: undefined, comps: [0] }],
			['two parts', { partSlugs: [H, 'connectors'] }],
			['a partial', { result: 'Partial' }],
			['a split', { result: 'Partial', split: { keptSlugs: [H], keptGrams: 1, lostGrams: 1 } }],
			['a part not on the plate', { plateNumber: 1 }],
			['an unknown piece', { comps: [99] }],
			['a prototype slug', { partSlug: 'constructor' }]
		];
		for (const [name, over] of bad) {
			expect(
				status(() =>
					addRun(db, id, 'owner', {
						plateNumber: 18,
						partSlug: H,
						comps: [0, 1],
						date: '2026-01-02',
						result: 'Success',
						...over
					})
				),
				name
			).toBe(400);
		}
		expect(db.select().from(printRuns).where(eq(printRuns.buildId, id)).all()).toHaveLength(0);
		expect(status(() => logPieces(id, [0, 1], 'Success', { partSlugs: null }))).toBe(0);
		expect(
			status(() =>
				addRun(db, id, 'viewer', {
					plateNumber: 18,
					partSlug: H,
					comps: [0, 1],
					date: '2026-01-02',
					result: 'Success'
				})
			)
		).toBe(403);
	});
});

describe('a run that does not know about pieces (a printer job finishing)', () => {
	const whole = (id: string, result: string) =>
		addRun(db, id, 'owner', { plateNumber: 18, date: '2026-01-02', result, hours: 1 });
	it('Success of the whole plate with a piece print on it ticks only those pieces', () => {
		const id = mk();
		start(id, [0, 1, 2]);
		const { runId } = whole(id, 'Success');
		const v = view(id);
		expect(v.runs.find((r) => r.id === runId)).toMatchObject({ partSlug: H, comps: [0, 1, 2] });
		expect(v.state[H]).toMatchObject({ status: 'To print', printingComps: null });
		expect(ticked(id)).toEqual([0, 1, 2]);
	});
	it('Failed flags Reprint without ticking; Partial just ends the print', () => {
		const id = mk();
		start(id, [0, 1, 2]);
		whole(id, 'Failed');
		expect(view(id).state[H].status).toBe('Reprint');
		expect(ticked(id)).toEqual([]);
		const id2 = mk();
		start(id2, [0, 1, 2]);
		whole(id2, 'Partial');
		expect(view(id2).state[H]).toMatchObject({ status: 'To print', printingComps: null });
		expect(ticked(id2)).toEqual([]);
	});
	it('with no piece print on the part it is the ordinary whole-plate run', () => {
		const id = mk();
		whole(id, 'Success');
		expect(view(id).state[H].status).toBe('Printed');
		expect(ticked(id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
	});
});

describe('undo, edit and delete', () => {
	it('undo with the snapshot from before puts the piece print back', () => {
		const id = mk();
		start(id, [0, 1, 2]);
		const before = snapshotParts(view(id), [H]);
		const { runId } = logPieces(id, [0, 1, 2]);
		expect(ticked(id)).toEqual([0, 1, 2]);
		undoRun(db, id, 'owner', runId, { parts: before });
		const v = view(id);
		expect(v.state[H]).toMatchObject({ status: 'Printing', printingComps: [0, 1, 2] });
		expect(ticked(id)).toEqual([]);
		expect(v.runs).toHaveLength(0);
		const row = acts(id, 'run.undo').at(-1)!;
		expect(describeActivity({ ...row, at: row.at.toISOString(), userName: 'Sam' }, v)).toBe(
			'Sam undid a successful print of 3 pieces of Harness and Straps (plate 18)'
		);
	});
	it('undo refuses a snapshot with a bad piece list', () => {
		const id = mk();
		const before = snapshotParts(view(id), [H]);
		const { runId } = logPieces(id, [0, 1, 2]);
		for (const printingComps of [[99], [0, 0], 'x', [1.5]]) {
			expect(
				status(() =>
					undoRun(db, id, 'owner', runId, {
						parts: [{ ...before[0], status: 'Printing', printingComps }]
					})
				)
			).toBe(400);
		}
		expect(view(id).runs).toHaveLength(1);
	});
	it('deleting a Success log unticks its pieces and keeps the others', () => {
		const id = mk();
		updatePart(db, id, 'owner', H, { comps: { '8': true } });
		const a = logPieces(id, [0, 1, 2]).runId;
		logPieces(id, [3, 4]);
		deleteRun(db, id, 'owner', a);
		expect(ticked(id)).toEqual([3, 4, 8]);
		expect(view(id).state[H].status).toBe('To print');
		const row = acts(id, 'run.delete').at(-1)!;
		expect(row.payload).toMatchObject({ comps: [0, 1, 2] });
	});
	it('deleting the run that completed the part sets it back to To print', () => {
		const id = mk();
		logPieces(id, [0, 1, 2, 3, 4]);
		const last = logPieces(id, [5, 6, 7, 8]).runId;
		expect(view(id).state[H].status).toBe('Printed');
		deleteRun(db, id, 'owner', last);
		expect(view(id).state[H]).toMatchObject({ status: 'To print', printedOn: null });
		expect(ticked(id)).toEqual([0, 1, 2, 3, 4]);
	});
	it('editing Success to Failed unticks the pieces and flags Reprint', () => {
		const id = mk();
		const a = logPieces(id, [0, 1, 2]).runId;
		updateRun(db, id, 'owner', a, { result: 'Failed' });
		expect(view(id).state[H].status).toBe('Reprint');
		expect(ticked(id)).toEqual([]);
		updateRun(db, id, 'owner', a, { result: 'Success' });
		expect(ticked(id)).toEqual([0, 1, 2]);
		expect(view(id).state[H].status).toBe('To print');
	});
	it('a piece log cannot be moved to another part', () => {
		const id = mk();
		const a = logPieces(id, [0, 1, 2]).runId;
		expect(status(() => updateRun(db, id, 'owner', a, { partSlug: 'connectors' }))).toBe(400);
	});
	it('deleting an old log while another piece print is on the printer leaves that print', () => {
		const id = mk();
		const a = logPieces(id, [0, 1, 2]).runId;
		start(id, [3, 4]);
		deleteRun(db, id, 'owner', a);
		expect(view(id).state[H]).toMatchObject({ status: 'Printing', printingComps: [3, 4] });
	});
});

describe('hand ticks and the piece list', () => {
	it('ticking a piece that is on the printer takes it off the list', () => {
		const id = mk();
		start(id, [0, 1, 2]);
		updatePart(db, id, 'owner', H, { comps: { '1': true } });
		expect(view(id).state[H]).toMatchObject({ status: 'Printing', printingComps: [0, 2] });
	});
	it('ticking all of them ends the print: To print, or Printed with every piece ticked', () => {
		const id = mk();
		start(id, [0, 1]);
		updatePart(db, id, 'owner', H, { comps: { '0': true, '1': true } });
		expect(view(id).state[H]).toMatchObject({ status: 'To print', printingComps: null });
		const all = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i), true]));
		const id2 = mk();
		start(id2, [0, 1]);
		updatePart(db, id2, 'owner', H, { comps: all });
		expect(view(id2).state[H]).toMatchObject({ status: 'Printed', printingComps: null });
	});
	it('ticking with no piece print under way is only a tick, and unticking works', () => {
		const id = mk();
		updatePart(db, id, 'owner', H, { comps: { '3': true } });
		updatePart(db, id, 'owner', H, { comps: { '3': false } });
		expect(ticked(id)).toEqual([]);
		expect(view(id).state[H].status).toBe('To print');
	});
	it('refuses a ticks object that is not booleans or is huge', () => {
		const id = mk();
		expect(status(() => updatePart(db, id, 'owner', H, { comps: { '0': 'yes' } as never }))).toBe(
			400
		);
		const huge = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [String(i), true]));
		expect(status(() => updatePart(db, id, 'owner', H, { comps: huge }))).toBe(400);
	});
});
