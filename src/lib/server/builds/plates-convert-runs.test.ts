/**
 * Confirmed plate replacement converts print logs attached to plates into part logs. A piece run
 * ("Print some pieces…") stays a run of the same pieces; a subset run ("Print some parts…") becomes runs of
 * exactly its parts; the row keeps its id, creation time and planned time.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, runMigrations, type Db } from '../db';
import { member, organization, printRuns, templates, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { addRun, deleteRun } from './actions';
import { createBuild } from './create';
import { setPlateLayout } from './plates';
import { loadBuildView } from './view';

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

const mk = () =>
	createBuild(db, { organizationId: orgId, templateId, designId: null, name: 'B' }, 'owner');
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const rows = (id: string) => db.select().from(printRuns).where(eq(printRuns.buildId, id)).all();
const ticks = (id: string) =>
	Object.entries(view(id).state[H].comps)
		.filter(([, v]) => v)
		.map(([k]) => Number(k))
		.sort((a, b) => a - b);
const convert = (id: string) => setPlateLayout(db, id, 'owner', { key: 'h2d', convertRuns: true });

describe('converting plate logs on a confirmed plate replacement', () => {
	it('keeps a piece run a run of the same pieces, with its row and ticks', () => {
		const id = mk();
		const plate = view(id).plates.find((p) => p.parts.includes(H))!.number;
		const { runId } = addRun(db, id, 'owner', {
			plateNumber: plate,
			partSlug: H,
			comps: [0, 1, 2],
			date: '2026-03-01',
			result: 'Success',
			grams: 80,
			hours: 2
		});
		const [before] = rows(id);
		expect(view(id).state[H].status).toBe('To print');
		const ticksBefore = ticks(id);
		expect(ticksBefore).toEqual([0, 1, 2]);

		expect(convert(id).convertedRuns).toBe(1);

		const after = rows(id);
		expect(after).toHaveLength(1);
		expect(after[0]).toMatchObject({
			id: runId,
			plateNumber: null,
			partSlug: H,
			partSlugs: null,
			comps: [0, 1, 2],
			grams: 80,
			hours: 2,
			estSeconds: before.estSeconds
		});
		expect(after[0].createdAt!.getTime()).toBe(before.createdAt!.getTime());
		const v = view(id);
		expect(v.runs[0]).toMatchObject({ partSlug: H, comps: [0, 1, 2] });
		expect(v.state[H].status).toBe('To print');
		expect(ticks(id)).toEqual(ticksBefore);

		// an unrelated run deleted afterwards recomputes nothing wrong: the part is not Printed
		const other = addRun(db, id, 'owner', {
			partSlug: 'wing-left',
			date: '2026-03-02',
			result: 'Success'
		});
		deleteRun(db, id, 'owner', other.runId);
		expect(view(id).state[H].status).toBe('To print');
		expect(ticks(id)).toEqual(ticksBefore);
		// deleting the piece run itself un-ticks, still not Printed
		deleteRun(db, id, 'owner', runId);
		expect(view(id).state[H].status).toBe('To print');
	});

	it('turns a subset run into runs of exactly its parts', () => {
		const id = mk();
		const plate = view(id).plates.find((p) => p.parts.length >= 3)!;
		const pick = plate.parts.slice(0, 2);
		addRun(db, id, 'owner', {
			plateNumber: plate.number,
			partSlugs: pick,
			date: '2026-03-01',
			result: 'Success',
			grams: 10,
			hours: 4
		});
		const [orig] = rows(id);
		expect(convert(id).convertedRuns).toBe(1);
		const after = rows(id);
		expect(after.map((r) => r.partSlug).sort()).toEqual([...pick].sort());
		for (const r of after) {
			expect(r).toMatchObject({
				plateNumber: null,
				partSlugs: null,
				comps: null,
				grams: 5,
				hours: 2,
				result: 'Success'
			});
			expect(r.createdAt!.getTime()).toBe(orig.createdAt!.getTime());
		}
		expect(after.some((r) => r.id === orig.id)).toBe(true);
	});

	it('splits a whole-plate run over its parts as before', () => {
		const id = mk();
		const plate = view(id).plates.find((p) => p.parts.length === 2)!;
		addRun(db, id, 'owner', {
			plateNumber: plate.number,
			date: '2026-03-01',
			result: 'Success',
			grams: 100,
			hours: 7
		});
		convert(id);
		const after = rows(id);
		expect(after.map((r) => r.partSlug).sort()).toEqual([...plate.parts].sort());
		expect(after.map((r) => [r.grams, r.hours])).toEqual([
			[50, 3.5],
			[50, 3.5]
		]);
	});
});
