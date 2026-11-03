import { beforeEach, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildFilaments,
	buildParts,
	buildPlates,
	builds as buildsTable,
	colorDesigns,
	member,
	organization,
	printRuns,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { setPartStatus } from './actions';
import { createBuild } from './create';
import { importPrototype, previewPrototype } from './import';
import { runImport } from './import-cli';
import { onBuildEvents } from './test-helpers';

let db: Db;
let buildId: string;

const data = () => ({
	format: 'tmt-prototype-v1',
	parts: {
		'seat-center': { status: 'Printed', printed: '2026-02-03', comps: { '0': true } },
		'wing-right': { status: 'Printing', started: '2026-03-01T10:00:00.000Z', runEst: 7200 },
		buckles: { status: 'Reprint', log: [{ d: '2026-02-01', r: 'Failed', g: 5, h: 1, note: 'x' }] }
	},
	plates: {
		'12': {
			slicerG: 120,
			log: [
				{ d: '2026-02-04', r: 'Success', g: 118, h: 4, note: '', parts: ['connectors', 'hub-caps'] }
			]
		},
		'13': {
			slicerByPart: { 'rims-1-4': 80 },
			log: [{ d: '2026-02-05', r: 'Success', g: 80, h: 9, note: '', part: 'rims-1-4' }]
		}
	},
	settings: { filament: { spools: { ob: 4 } } }
});

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	const templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: 'org1', name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	for (const [u, role] of [
		['owner', 'owner'],
		['editor', 'editor'],
		['viewer', 'viewer'],
		['outsider', null]
	] as const) {
		db.insert(user)
			.values({ id: u, name: `User ${u}`, email: `${u}@example.test` })
			.run();
		if (role)
			db.insert(member)
				.values({ id: `m-${u}`, organizationId: 'org1', userId: u, role, createdAt: new Date() })
				.run();
	}
	buildId = createBuild(
		db,
		{ organizationId: 'org1', templateId, designId: null, name: 'B' },
		'owner'
	);
});

const n = (t: typeof printRuns | typeof activity) =>
	db.select({ n: count() }).from(t).where(eq(t.buildId, buildId)).get()!.n;

describe('importPrototype', () => {
	it('applies everything to an empty build, with one activity row and an event', () => {
		const events = onBuildEvents(buildId);
		const before = n(activity);
		const res = importPrototype(db, buildId, 'editor', data());
		expect(res).toMatchObject({ parts: 3, runs: 3, plates: 2, spools: 1, replaced: false });
		const part = (slug: string) =>
			db.select().from(buildParts).where(eq(buildParts.partSlug, slug)).get()!;
		expect(part('seat-center')).toMatchObject({
			status: 'Printed',
			printedOn: '2026-02-03',
			comps: { '0': true }
		});
		expect(part('wing-right')).toMatchObject({ status: 'Printing', runEstSeconds: 7200 });
		expect(part('wing-right').startedAt?.toISOString()).toBe('2026-03-01T10:00:00.000Z');
		expect(n(printRuns)).toBe(3);
		const runs = db.select().from(printRuns).all();
		expect(runs.every((r) => r.userId === 'editor')).toBe(true);
		expect(runs.find((r) => r.plateNumber === 12)?.partSlugs).toEqual(['connectors', 'hub-caps']);
		expect(db.select().from(buildPlates).where(eq(buildPlates.number, 12)).get()!.slicerGrams).toBe(
			120
		);
		expect(
			db.select().from(buildFilaments).where(eq(buildFilaments.roleKey, 'primary')).get()!.spools
		).toBe(4);
		expect(n(activity)).toBe(before + 1);
		const row = db.select().from(activity).where(eq(activity.kind, 'build.import')).all();
		expect(row).toHaveLength(1);
		expect(row[0].payload).toMatchObject({ parts: 3, runs: 3 });
		expect(events.map((e) => e.kind)).toEqual(['build.import']);
	});

	it('refuses a build with progress (409) unless replace is set', () => {
		setPartStatus(db, buildId, 'owner', 'buckles', { status: 'Printed' });
		expect(() => importPrototype(db, buildId, 'owner', data())).toThrowError(
			expect.objectContaining({ status: 409 })
		);
		expect(n(printRuns)).toBe(0);
		const res = importPrototype(db, buildId, 'owner', data(), { replace: true });
		expect(res.replaced).toBe(true);
		expect(n(printRuns)).toBe(3);
		// a second replace wipes the previous import rather than doubling it
		importPrototype(db, buildId, 'owner', data(), { replace: true });
		expect(n(printRuns)).toBe(3);
		const reset = { format: 'tmt-prototype-v1', parts: {}, plates: {} };
		importPrototype(db, buildId, 'owner', reset, { replace: true });
		expect(
			db.select().from(buildParts).where(eq(buildParts.partSlug, 'seat-center')).get()!.status
		).toBe('To print');
	});

	it('403 for a viewer, 404 for an outsider, 400 for a bad format; nothing written', () => {
		const status = (fn: () => unknown) => {
			try {
				fn();
			} catch (e) {
				return e instanceof ApiError ? e.status : -1;
			}
			return 0;
		};
		expect(status(() => importPrototype(db, buildId, 'viewer', data()))).toBe(403);
		expect(status(() => previewPrototype(db, buildId, 'viewer', data()))).toBe(403);
		expect(status(() => importPrototype(db, buildId, 'outsider', data()))).toBe(404);
		expect(status(() => importPrototype(db, buildId, 'owner', { ...data(), format: 'x' }))).toBe(
			400
		);
		expect(n(printRuns)).toBe(0);
		expect(db.select().from(activity).where(eq(activity.kind, 'build.import')).all()).toHaveLength(
			0
		);
	});

	it('previews without writing', () => {
		const p = previewPrototype(db, buildId, 'editor', data());
		expect(p).toMatchObject({ parts: 3, runs: 3, empty: true });
		expect(n(printRuns)).toBe(0);
	});

	it('CLI path: dry run on a new build rolls back; real run imports with no user', () => {
		const slug = db.select().from(colorDesigns).get()!.slug;
		const target = { newBuild: { name: 'Fresh', workspace: 'chapter', design: slug } };
		const builds0 = db.select({ n: count() }).from(buildsTable).get()!.n;
		const dry = runImport(db, target, data(), { replace: false, dryRun: true });
		expect(dry.result).toMatchObject({ parts: 3, runs: 3 });
		expect(db.select({ n: count() }).from(buildsTable).get()!.n).toBe(builds0);

		const real = runImport(db, target, data(), { replace: false, dryRun: false });
		expect(db.select({ n: count() }).from(buildsTable).get()!.n).toBe(builds0 + 1);
		const imp = db.select().from(activity).where(eq(activity.kind, 'build.import')).get()!;
		expect(imp.buildId).toBe(real.buildId);
		expect(imp.userId).toBeNull();
		// existing build, not empty -> 409
		expect(() =>
			runImport(db, { buildId: real.buildId! }, data(), { replace: false, dryRun: false })
		).toThrowError(expect.objectContaining({ status: 409 }));
	});
});
