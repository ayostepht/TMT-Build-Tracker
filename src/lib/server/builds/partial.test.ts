import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildPlates,
	member,
	organization,
	printRuns,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { addRun, deleteRun, printingAction, undoRun, updatePart } from './actions';
import { createBuild } from './create';
import { loadBuildView } from './view';
import { snapshotParts } from '../../domain/logrun';
import { describeActivity } from '../../domain/activity';
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
	for (const u of ['owner', 'editor', 'viewer']) {
		db.insert(user)
			.values({ id: u, name: `User ${u}`, email: `${u}@example.test` })
			.run();
		db.insert(member)
			.values({ id: `m-${u}`, organizationId: orgId, userId: u, role: u, createdAt: new Date() })
			.run();
	}
});

const mk = () =>
	createBuild(db, { organizationId: orgId, templateId, designId: null, name: 'B' }, 'owner');
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const acts = (id: string, kind?: string) =>
	db
		.select()
		.from(activity)
		.where(eq(activity.buildId, id))
		.all()
		.filter((a) => !kind || a.kind === kind);
const runRows = (id: string) => db.select().from(printRuns).where(eq(printRuns.buildId, id)).all();

/** A single-run plate of three or more parts, with typed weights 100 / 50 / rest. */
function setup() {
	const id = mk();
	const v = view(id);
	const plate = v.plates.find((p) => !p.perPartRuns && p.runs === 1 && p.parts.length >= 3)!;
	const [a, b, c] = plate.parts;
	updatePart(db, id, 'owner', a, { manualGrams: 100 });
	updatePart(db, id, 'owner', b, { manualGrams: 50 });
	for (const s of plate.parts.slice(2))
		updatePart(db, id, 'owner', s, { manualGrams: 50 / (plate.parts.length - 2) });
	return { id, plate, a, b, c, all: plate.parts };
}
const body = (n: number, split: unknown, over: object = {}) => ({
	plateNumber: n,
	date: '2026-01-02',
	result: 'Partial',
	hours: 6,
	note: '',
	split,
	...over
});

describe('Partial with per-part results', () => {
	it('makes a Success run for the ticked parts and a Failed run for the rest, in one activity row', () => {
		const { id, plate, a, b, all } = setup();
		printingAction(db, id, 'owner', { action: 'start', slugs: all });
		printingAction(db, id, 'owner', { action: 'setEstimate', slugs: all, seconds: 7200 });
		const before = acts(id).length;
		const { runId, runIds } = addRun(
			db,
			id,
			'owner',
			body(plate.number, { keptSlugs: [a], keptGrams: 100, lostGrams: 30 })
		);
		expect(runIds).toHaveLength(2);
		expect(runId).toBe(runIds[0]);
		expect(acts(id).length).toBe(before + 1);
		const row = acts(id, 'run.add').at(-1)!;
		expect(row.payload).toMatchObject({
			split: true,
			result: 'Partial',
			runIds,
			kept: [a],
			keptGrams: 100,
			lostGrams: 30
		});
		const v = view(id);
		const ok = v.runs.find((r) => r.id === runIds[0])!;
		const bad = v.runs.find((r) => r.id === runIds[1])!;
		expect([ok.result, ok.partSlugs, ok.grams]).toEqual(['Success', [a], 100]);
		expect([bad.result, bad.grams]).toEqual(['Failed', 30]);
		expect(bad.partSlugs).not.toContain(a);
		// 100 g of 200 g: half of the 6 h and half of the 2 h run time, the rest to the failed half.
		expect(ok.hours).toBe(3);
		expect(bad.hours).toBe(3);
		expect(ok.estSeconds).toBe(3600);
		expect(bad.estSeconds).toBe(3600);
		expect(v.state[a].status).toBe('Printed');
		expect(v.state[b].status).toBe('Reprint');
		expect(describeActivity(v.activity[0], v)).toContain('logged a partial print');
		// kept / lost accounting
		const fs = filamentStats(v).reduce((t, s) => ({ k: t.k + s.keptG, l: t.l + s.lostG }), {
			k: 0,
			l: 0
		});
		expect(fs).toEqual({ k: 100, l: 30 });
	});

	it('scales hours by the ticked parts weight share', () => {
		const { id, plate, b } = setup();
		const { runIds } = addRun(
			db,
			id,
			'owner',
			body(plate.number, { keptSlugs: [b], keptGrams: null, lostGrams: null }, { hours: 4 })
		);
		const rows = runRows(id);
		const ok = rows.find((r) => r.id === runIds[0])!;
		const lost = rows.find((r) => r.id === runIds[1])!;
		expect(ok.hours).toBe(1); // 50 of 200 g
		expect(lost.hours).toBe(3);
		expect(ok.grams).toBeNull();
	});

	it('undo deletes both runs and writes one run.undo row', () => {
		const { id, plate, a, all } = setup();
		const v0 = view(id);
		const { runId, runIds } = addRun(
			db,
			id,
			'owner',
			body(plate.number, { keptSlugs: [a], keptGrams: 1, lostGrams: 2 })
		);
		const undone = undoRun(db, id, 'owner', runId, {
			parts: snapshotParts(v0, all),
			runIds
		});
		expect(undone.sort()).toEqual([...runIds].sort());
		expect(runRows(id)).toHaveLength(0);
		const u = acts(id, 'run.undo');
		expect(u).toHaveLength(1);
		expect(u[0].payload).toMatchObject({ split: true, runIds: expect.any(Array) });
		const v = view(id);
		for (const s of all) expect(v.state[s].status).toBe('To print');
	});

	it('undo skips a sibling that is already gone, and 404s when nothing is left', () => {
		const { id, plate, a, all } = setup();
		const v0 = view(id);
		const { runId, runIds } = addRun(
			db,
			id,
			'owner',
			body(plate.number, { keptSlugs: [a], keptGrams: 1, lostGrams: 2 })
		);
		deleteRun(db, id, 'owner', runIds[1]);
		expect(undoRun(db, id, 'owner', runId, { parts: snapshotParts(v0, all), runIds })).toEqual([
			runIds[0]
		]);
		expect(() => undoRun(db, id, 'owner', runId, { parts: [], runIds })).toThrowError(
			expect.objectContaining({ status: 404 })
		);
		expect(() =>
			undoRun(db, id, 'owner', runId, { parts: [], runIds: Array(11).fill('x') })
		).toThrow(ApiError);
	});

	it('undo never touches runs of another build', () => {
		const one = setup();
		const other = mk();
		const op = view(other).plates.find((p) => p.number === one.plate.number)!;
		const mine = addRun(db, other, 'owner', {
			plateNumber: op.number,
			date: '2026-01-02',
			result: 'Success'
		});
		const { runId, runIds } = addRun(
			db,
			one.id,
			'owner',
			body(one.plate.number, { keptSlugs: [one.a], keptGrams: 1, lostGrams: 2 })
		);
		undoRun(db, one.id, 'owner', runId, { parts: [], runIds: [...runIds, mine.runId] });
		expect(runRows(other)).toHaveLength(1);
		expect(runRows(one.id)).toHaveLength(0);
	});

	it('deleting one half recomputes only its parts', () => {
		const { id, plate, a, b } = setup();
		const { runIds } = addRun(
			db,
			id,
			'owner',
			body(plate.number, { keptSlugs: [a], keptGrams: 1, lostGrams: 2 })
		);
		deleteRun(db, id, 'owner', runIds[1]); // the Failed half
		let v = view(id);
		expect(v.state[a].status).toBe('Printed');
		expect(v.state[b].status).toBe('To print');
		deleteRun(db, id, 'owner', runIds[0]);
		v = view(id);
		expect(v.state[a].status).toBe('To print');
	});

	it('refuses ticks that are empty, all, or not on the plate, and other results', () => {
		const { id, plate, all } = setup();
		const other = view(id).plates.find((p) => p.number !== plate.number)!.parts[0];
		const tries: object[] = [
			body(plate.number, { keptSlugs: [] }),
			body(plate.number, { keptSlugs: all }),
			body(plate.number, { keptSlugs: [other] }),
			body(plate.number, { keptSlugs: ['constructor'] }),
			body(plate.number, { keptSlugs: ['__proto__'] }),
			body(plate.number, { keptSlugs: [all[0]] }, { result: 'Success' }),
			body(plate.number, 'nope'),
			body(plate.number, { keptSlugs: [all[0]], keptGrams: -1 }),
			{ ...body(plate.number, { keptSlugs: [all[0]] }), plateNumber: null, partSlug: all[0] }
		];
		for (const t of tries) {
			expect(() => addRun(db, id, 'owner', t)).toThrowError(
				expect.objectContaining({ status: 400 })
			);
		}
		expect(runRows(id)).toHaveLength(0);
	});

	it('refuses a split on a per-part or multi-run plate; a plain Partial is still accepted', () => {
		const id = mk();
		const v = view(id);
		const perPart = v.plates.find((p) => p.perPartRuns && p.parts.length >= 2)!;
		const multi = v.plates.find((p) => !p.perPartRuns && p.parts.length >= 2)!;
		db.update(buildPlates)
			.set({ runs: 2 })
			.where(and(eq(buildPlates.buildId, id), eq(buildPlates.number, multi.number)))
			.run();
		for (const p of [perPart, multi]) {
			expect(() =>
				addRun(db, id, 'owner', body(p.number, { keptSlugs: [p.parts[0]] }))
			).toThrowError(expect.objectContaining({ status: 400 }));
		}
		const plain = addRun(db, id, 'owner', {
			plateNumber: multi.number,
			date: '2026-01-02',
			result: 'Partial',
			grams: 20
		});
		expect(plain.runIds).toHaveLength(1);
		const row = runRows(id).find((r) => r.id === plain.runId)!;
		expect(row.result).toBe('Partial');
		// older Partial rows count as lost
		const fs = filamentStats(view(id)).reduce((t, s) => t + s.lostG, 0);
		expect(fs).toBe(20);
	});

	it('viewers cannot log, and a draft refuses it', () => {
		const { id, plate, a } = setup();
		expect(() => addRun(db, id, 'viewer', body(plate.number, { keptSlugs: [a] }))).toThrowError(
			expect.objectContaining({ status: 403 })
		);
		const draft = createBuild(
			db,
			{ organizationId: orgId, templateId, designId: null, name: 'D', kind: 'draft' },
			'owner'
		);
		expect(() => addRun(db, draft, 'owner', body(plate.number, { keptSlugs: [a] }))).toThrowError(
			expect.objectContaining({ status: 400 })
		);
		expect(
			db
				.select()
				.from(printRuns)
				.where(and(eq(printRuns.buildId, draft)))
				.all()
		).toHaveLength(0);
	});
});
