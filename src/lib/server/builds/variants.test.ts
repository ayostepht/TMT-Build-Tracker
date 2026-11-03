import { beforeEach, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { describeActivity } from '#lib/domain/activity.ts';
import { ApiError, isSiteAdmin, requireSiteAdmin } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildParts,
	builds,
	member,
	organization,
	templateModels,
	templatePartPlacements,
	templateParts,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import type { TemplateSeed } from '../seed/types';
import { setPartStatus, setVariant } from './actions';
import { backfillBuildParts } from './backfill';
import { createBuild } from './create';
import { onBuildEvents } from './test-helpers';
import { loadBuildView } from './view';

const tmt = templateSeeds[0];
let db: Db;
let templateId: string;
const orgId = 'org1';

function addUser(id: string, createdAt = new Date()) {
	db.insert(user)
		.values({ id, name: `User ${id}`, email: `${id}@Example.test`, createdAt })
		.run();
}

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	for (const [u, role] of [
		['owner', 'owner'],
		['editor', 'editor'],
		['viewer', 'viewer']
	]) {
		addUser(u);
		db.insert(member)
			.values({ id: `m-${u}`, organizationId: orgId, userId: u, role, createdAt: new Date() })
			.run();
	}
	addUser('outsider');
});

const mk = (variantChoices?: Record<string, string>) =>
	createBuild(
		db,
		{ organizationId: orgId, templateId, designId: null, name: 'B', variantChoices },
		'owner'
	);

describe('seed reconcile', () => {
	/** The seed as it was before variants: no variant parts, groups or placements. */
	function oldSeed(): TemplateSeed {
		const variantSlugs = new Set(
			tmt.variantGroups!.flatMap((g) => g.options.flatMap((o) => o.parts))
		);
		const keep = new Set(
			tmt
				.variantGroups!.flatMap((g) => g.options.filter((o) => o.key === g.defaultOption))
				.flatMap((o) => o.parts)
		);
		return {
			...tmt,
			parts: tmt.parts.filter((p) => !variantSlugs.has(p.slug) || keep.has(p.slug)),
			variantGroups: undefined,
			placements: undefined
		};
	}

	it('adds new parts, groups and placements to an already seeded DB without touching builds', () => {
		const old = openDb(':memory:');
		runMigrations(old);
		seedTemplates(old, [oldSeed()]);
		const tid = old.select({ id: templates.id }).from(templates).get()!.id;
		old
			.insert(organization)
			.values({ id: orgId, name: 'C', slug: 'c', createdAt: new Date() })
			.run();
		old.insert(user).values({ id: 'o', name: 'O', email: 'o@x.test' }).run();
		old
			.insert(member)
			.values({ id: 'm', organizationId: orgId, userId: 'o', role: 'owner', createdAt: new Date() })
			.run();
		const bid = createBuild(
			old,
			{ organizationId: orgId, templateId: tid, designId: null, name: 'B' },
			'o'
		);
		setPartStatus(old, bid, 'o', 'cushion-top', { status: 'Printed' });
		const buildsBefore = JSON.stringify(old.select().from(builds).all());
		const rowsBefore = old.select({ n: count() }).from(buildParts).get()!.n;
		expect(rowsBefore).toBe(33);

		const first = seedTemplates(old, templateSeeds);
		expect(first).toEqual({ inserted: [], updated: [tmt.slug] });
		expect(old.select({ n: count() }).from(templateParts).get()!.n).toBe(tmt.parts.length);
		expect(old.select({ n: count() }).from(templatePartPlacements).get()!.n).toBe(tmt.parts.length);
		expect(old.select().from(templates).get()!.variantGroups).toHaveLength(
			tmt.variantGroups!.length
		);
		// builds untouched by the seed
		expect(JSON.stringify(old.select().from(builds).all())).toBe(buildsBefore);
		expect(old.select({ n: count() }).from(buildParts).get()!.n).toBe(rowsBefore);

		// idempotent
		expect(seedTemplates(old, templateSeeds)).toEqual({ inserted: [], updated: [] });

		// backfill adds the new rows lazily, once, and keeps progress
		expect(backfillBuildParts(old)).toBe(tmt.parts.length - 33);
		expect(backfillBuildParts(old)).toBe(0);
		const v = loadBuildView(old, bid, 'o')!;
		expect(v.parts).toHaveLength(33);
		expect(v.allParts).toHaveLength(tmt.parts.length);
		expect(v.state['cushion-top'].status).toBe('Printed');
	});

	it('counts placed and unplaced parts', () => {
		const rows = db.select().from(templatePartPlacements).all();
		const placed = tmt.placements!.filter((p) => p.placed).length;
		expect(rows.filter((r) => r.placed)).toHaveLength(placed);
		expect(rows.filter((r) => !r.placed)).toHaveLength(tmt.parts.length - placed);
		// Only the harness, buckles and the bucket seat (no STEP geometry) stay unplaced.
		expect(
			rows
				.filter((r) => !r.placed)
				.map((r) => r.slug)
				.sort()
		).toEqual(['bucket-seat', 'buckles', 'harness']);
		expect(rows.find((r) => r.slug === 'hub-caps')!.instances).toHaveLength(1);
		expect(rows.find((r) => r.slug === 'tires')!.instances).toHaveLength(15);
	});
});

describe('variants in the build view', () => {
	it('defaults to the default options and creates rows for every part', () => {
		const id = mk();
		expect(
			db.select({ n: count() }).from(buildParts).where(eq(buildParts.buildId, id)).get()!.n
		).toBe(tmt.parts.length);
		const v = loadBuildView(db, id, 'owner')!;
		expect(v.variantChoices).toEqual({
			seat: 'cushions',
			'rear-caster': 'kit',
			footrest: 'one-piece',
			rim: 'standard',
			headrest: 'include',
			'push-handle': 'include'
		});
		expect(v.parts).toHaveLength(33);
		expect(Object.keys(v.state)).toHaveLength(33);
		expect(v.allParts).toHaveLength(tmt.parts.length);
		expect(v.allParts.find((p) => p.slug === 'bucket-seat')!.variantOption).toBe('bucket-seat');
		expect(v.parts.find((p) => p.slug === 'seat-center')!.variantGroup).toBeNull();
		expect(v.model).toBeNull();
	});

	it('treats a build with no stored choices as defaults', () => {
		const id = mk();
		db.update(builds).set({ variantChoices: null }).where(eq(builds.id, id)).run();
		expect(loadBuildView(db, id, 'owner')!.variantChoices.seat).toBe('cushions');
	});

	it('switching the seat swaps parts and plates, and progress survives a round trip', () => {
		const id = mk();
		setPartStatus(db, id, 'owner', 'cushion-top', { status: 'Printed' });
		const events = onBuildEvents(id);
		setVariant(db, id, 'editor', { group: 'seat', option: 'bucket-seat' });
		expect(events.map((e) => e.kind)).toContain('build.variant');

		let v = loadBuildView(db, id, 'owner')!;
		const slugs = v.parts.map((p) => p.slug);
		expect(slugs).toContain('bucket-seat');
		expect(slugs).not.toContain('cushion-top');
		expect(slugs).not.toContain('cushion-base');
		expect(v.state['cushion-top']).toBeUndefined();
		expect(v.state['bucket-seat'].status).toBe('To print');
		expect(v.plates.map((p) => p.number)).not.toContain(19);
		expect(v.plates.map((p) => p.number)).not.toContain(20);
		expect(v.plates.flatMap((p) => p.parts)).not.toContain('cushion-top');
		expect(v.allParts.map((p) => p.slug)).toContain('cushion-top');

		const act = db.select().from(activity).where(eq(activity.kind, 'build.variant')).get()!;
		expect(act.userId).toBe('editor');
		expect(
			describeActivity(
				{
					id: 'a',
					userId: 'editor',
					userName: 'Steph',
					kind: act.kind,
					payload: act.payload,
					at: ''
				},
				v
			)
		).toBe('Steph switched Seat to Foaming TPU bucket seat');

		setVariant(db, id, 'owner', { group: 'seat', option: 'cushions' });
		v = loadBuildView(db, id, 'owner')!;
		expect(v.state['cushion-top'].status).toBe('Printed');
		expect(v.plates.map((p) => p.number)).toContain(19);
		expect(v.parts.map((p) => p.slug)).not.toContain('bucket-seat');
	});

	it('swaps the rims plate and keeps plateless variant parts as their own units', () => {
		const id = mk({ rim: 'smaller', footrest: 'two-piece' });
		const v = loadBuildView(db, id, 'owner')!;
		expect(v.plates.map((p) => p.number)).not.toContain(13);
		expect(v.plates.map((p) => p.number)).not.toContain(24);
		expect(v.parts.map((p) => p.slug)).toEqual(
			expect.arrayContaining(['rims-small-1-4', 'footrest-front', 'footrest-rear'])
		);
	});

	it('enforces permissions and validates input', () => {
		const id = mk();
		const body = { group: 'seat', option: 'bucket-seat' };
		expect(() => setVariant(db, id, 'viewer', body)).toThrowError(
			expect.objectContaining({ status: 403 })
		);
		expect(() => setVariant(db, id, 'outsider', body)).toThrowError(
			expect.objectContaining({ status: 404 })
		);
		expect(() => setVariant(db, id, 'owner', { group: 'nope', option: 'x' })).toThrow(ApiError);
		expect(() => setVariant(db, id, 'owner', { group: 'seat', option: 'nope' })).toThrow(ApiError);
		expect(() => setVariant(db, id, 'owner', { group: 'seat' })).toThrow(ApiError);
		expect(
			db.select({ n: count() }).from(activity).where(eq(activity.kind, 'build.variant')).get()!.n
		).toBe(0);
		expect(() =>
			createBuild(
				db,
				{
					organizationId: orgId,
					templateId,
					designId: null,
					name: 'x',
					variantChoices: { seat: 'zzz' }
				},
				'owner'
			)
		).toThrow(ApiError);
	});

	it('exposes the model once a template_models row exists', () => {
		const id = mk();
		db.insert(templateModels)
			.values({ templateId, glbPath: 'x.glb', version: 'v1', size: 10, slugs: ['seat-center'] })
			.run();
		const m = loadBuildView(db, id, 'viewer')!.model!;
		expect(m.url).toBe(`/api/templates/${templateId}/model.glb?v=v1`);
		expect(m.slugs).toEqual(['seat-center']);
		expect(m.placements).toHaveLength(tmt.parts.length);
		expect(m.placements.find((p) => p.slug === 'wing-left')).toMatchObject({
			placed: true,
			instances: []
		});
	});
});

describe('site admin', () => {
	it('is the earliest user, or anyone in ADMIN_EMAILS (case-insensitive)', () => {
		const empty = openDb(':memory:');
		runMigrations(empty);
		const add = (id: string, email: string, t: number) =>
			empty
				.insert(user)
				.values({ id, name: id, email, createdAt: new Date(t) })
				.run();
		add('second', 'second@x.test', 2000);
		add('first', 'first@x.test', 1000);
		add('third', 'Third@X.test', 3000);
		const prev = process.env.ADMIN_EMAILS;
		try {
			delete process.env.ADMIN_EMAILS;
			expect(isSiteAdmin(empty, { id: 'first', email: 'first@x.test' })).toBe(true);
			expect(isSiteAdmin(empty, { id: 'second', email: 'second@x.test' })).toBe(false);
			expect(() => requireSiteAdmin(empty, { id: 'second', email: 'second@x.test' })).toThrow(
				ApiError
			);
			process.env.ADMIN_EMAILS = ' THIRD@x.test , other@x.test';
			expect(isSiteAdmin(empty, { id: 'third', email: 'Third@X.test' })).toBe(true);
			expect(isSiteAdmin(empty, { id: 'second', email: 'second@x.test' })).toBe(false);
		} finally {
			if (prev === undefined) delete process.env.ADMIN_EMAILS;
			else process.env.ADMIN_EMAILS = prev;
		}
	});
});
