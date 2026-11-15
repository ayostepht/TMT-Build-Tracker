import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildParts,
	buildPlates,
	member,
	organization,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { updatePart, updatePlate } from './actions';
import { createBuild } from './create';
import { gramsSourceOf, loadBuildView } from './view';
import { filamentStats, partGrams, plateGrams } from '../../domain/accounting';
import { describeActivity } from '../../domain/activity';

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
const mk = (kind: 'build' | 'draft' = 'build') =>
	createBuild(db, { organizationId: orgId, templateId, designId: null, name: 'B', kind }, 'owner');
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const lastKind = (id: string) =>
	db.select().from(activity).where(eq(activity.buildId, id)).all().at(-1)!;

describe('updatePart manualGrams', () => {
	it('stores the typed weight, shows it as "your entry" and fills the plate and totals', () => {
		const id = mk();
		const before = view(id);
		expect(partGrams(before, 'rear-caster-left').source).toBe('none');
		expect(
			plateGrams(
				before,
				before.plates.find((p) => p.number === 9)!
			).unknown
		).toEqual(['rear-caster-left', 'rear-caster-right']);
		updatePart(db, id, 'editor', 'rear-caster-left', { manualGrams: 62.456 });
		const v = view(id);
		expect(v.state['rear-caster-left'].manualGrams).toBe(62.46);
		expect(partGrams(v, 'rear-caster-left')).toMatchObject({ total: 62.46, source: 'user' });
		const plate = v.plates.find((p) => p.number === 9)!;
		expect(plateGrams(v, plate)).toMatchObject({ total: 62.46, unknown: ['rear-caster-right'] });
		const need = (x: typeof v) => filamentStats(x).reduce((a, s) => a + s.need, 0);
		expect(need(v) - need(before)).toBeCloseTo(62.46);
		const row = lastKind(id);
		expect(row.kind).toBe('part.grams');
		expect(row.payload).toMatchObject({ slug: 'rear-caster-left', manualGrams: 62.46 });
		expect(
			describeActivity({ ...row, at: row.at.toISOString(), userName: 'Sam' } as never, v)
		).toContain('set the weight of');
	});

	it('null clears it; clearing a part with no entry is refused', () => {
		const id = mk();
		updatePart(db, id, 'owner', 'push-top', { manualGrams: 300 });
		updatePart(db, id, 'owner', 'push-top', { manualGrams: null });
		expect(view(id).state['push-top'].manualGrams).toBeNull();
		expect(partGrams(view(id), 'push-top').source).toBe('bom');
		expect(lastKind(id).payload).toMatchObject({ manualGrams: null, cleared: true });
		expect(() => updatePart(db, id, 'owner', 'push-top', { manualGrams: null })).toThrow(ApiError);
	});

	it.each([[-1], [Number.NaN], [20001], ['12'], [Infinity]])('refuses %s', (bad) => {
		const id = mk();
		expect(() => updatePart(db, id, 'owner', 'push-top', { manualGrams: bad })).toThrow(ApiError);
		expect(view(id).state['push-top'].manualGrams ?? null).toBeNull();
	});

	it('is refused for viewers (403) and in drafts (400)', () => {
		const id = mk();
		expect(() => updatePart(db, id, 'viewer', 'push-top', { manualGrams: 5 })).toThrow(
			expect.objectContaining({ status: 403 })
		);
		const d = mk('draft');
		expect(() => updatePart(db, d, 'owner', 'push-top', { manualGrams: 5 })).toThrow(
			expect.objectContaining({ status: 400 })
		);
	});

	it('must be sent on its own, and an unknown part is a 404', () => {
		const id = mk();
		expect(() =>
			updatePart(db, id, 'owner', 'push-top', { manualGrams: 5, assigneeUserId: null })
		).toThrow(ApiError);
		expect(() => updatePart(db, id, 'owner', 'nope', { manualGrams: 5 })).toThrow(
			expect.objectContaining({ status: 404 })
		);
	});
});

describe('request-supplied keys', () => {
	it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
		'part slug %s is a 404 and writes no activity',
		(slug) => {
			const id = mk();
			const n = () => db.select().from(activity).where(eq(activity.buildId, id)).all().length;
			const before = n();
			for (const body of [{ manualGrams: 5 }, { comps: { 0: true } }]) {
				expect(() => updatePart(db, id, 'owner', slug, body)).toThrow(
					expect.objectContaining({ status: 404 })
				);
			}
			expect(n()).toBe(before);
		}
	);

	it('plate grams over the cap are a 400', () => {
		const id = mk();
		const slug = view(id).plates.find((p) => p.number === 13)!.parts[0];
		expect(() => updatePlate(db, id, 'owner', 10, { slicerGrams: 20001 })).toThrow(
			expect.objectContaining({ status: 400 })
		);
		expect(() => updatePlate(db, id, 'owner', 13, { slicerByPart: { [slug]: 1e9 } })).toThrow(
			expect.objectContaining({ status: 400 })
		);
		updatePlate(db, id, 'owner', 10, { slicerGrams: 20000 });
	});
});

describe('updatePlate sets the grams source', () => {
	const src = (id: string, n: number) =>
		db
			.select({ s: buildPlates.slicerGramsSource })
			.from(buildPlates)
			.where(and(eq(buildPlates.buildId, id), eq(buildPlates.number, n)))
			.get()!.s;

	it('typed grams are "user"; clearing them clears the source; the activity payload stays clean', () => {
		const id = mk();
		updatePlate(db, id, 'owner', 10, { slicerGrams: 280 });
		expect(src(id, 10)).toBe('user');
		const v = view(id);
		expect(v.plates.find((p) => p.number === 10)!.gramsSource).toBe('user');
		expect(
			plateGrams(
				v,
				v.plates.find((p) => p.number === 10)!
			)
		).toMatchObject({
			perRun: 280,
			source: 'user'
		});
		expect(lastKind(id).payload).not.toHaveProperty('slicerGramsSource');
		updatePlate(db, id, 'owner', 10, { slicerGrams: null });
		expect(src(id, 10)).toBeNull();
	});

	it('per-part entries are "user" too', () => {
		const id = mk();
		const slug = view(id).plates.find((p) => p.number === 13)!.parts[0];
		updatePlate(db, id, 'owner', 13, { slicerByPart: { [slug]: 120 } });
		expect(src(id, 13)).toBe('user');
		updatePlate(db, id, 'owner', 13, { slicerByPart: {} });
		expect(src(id, 13)).toBeNull();
	});
});

describe('loadBuildView grams columns', () => {
	it('reads manual_grams from build_parts', () => {
		const id = mk();
		db.update(buildParts)
			.set({ manualGrams: 12.5 })
			.where(and(eq(buildParts.buildId, id), eq(buildParts.partSlug, 'push-top')))
			.run();
		expect(view(id).state['push-top'].manualGrams).toBe(12.5);
		expect(view(id).state['seat-center'].manualGrams).toBeNull();
	});

	it('infers the source of rows from before the column existed', () => {
		const base = {
			source: 'template' as string | null,
			slicerGrams: null as number | null,
			slicerByPart: {} as Record<string, number>,
			perPartRuns: false,
			filamentGrams: {} as Record<string, number> | null,
			slicerGramsSource: null as 'user' | 'file' | 'printer' | null
		};
		const infer = (o: Partial<typeof base>, arranged?: Record<string, number>, learned = false) =>
			gramsSourceOf({ ...base, ...o }, arranged, learned);
		expect(infer({})).toBeNull();
		expect(infer({ slicerGrams: 200 })).toBe('user');
		expect(infer({ slicerGramsSource: 'printer', slicerGrams: 200 })).toBe('printer');
		// an upload whose slicer grams equal the file total came from the file
		expect(
			infer({ source: 'upload:1', slicerGrams: 230, filamentGrams: { primary: 200, accent: 30 } })
		).toBe('file');
		// ...an edited value differs, so it was typed
		expect(
			infer({ source: 'upload:1', slicerGrams: 260, filamentGrams: { primary: 200, accent: 30 } })
		).toBe('user');
		// twins written by an upload carry the same grams for every part
		expect(
			infer({
				source: 'upload:1',
				perPartRuns: true,
				slicerGrams: 90,
				slicerByPart: { a: 90, b: 90 }
			})
		).toBe('file');
		expect(infer({ source: 'upload:1', perPartRuns: true, slicerByPart: { a: 90, b: 95 } })).toBe(
			'user'
		);
		// no slicer grams, but the plate's file data comes from the build's own slice
		expect(infer({ source: 'arranged' }, { primary: 120 })).toBe('slice');
		expect(infer({}, { primary: 120 }, true)).toBe('slice');
	});
});
