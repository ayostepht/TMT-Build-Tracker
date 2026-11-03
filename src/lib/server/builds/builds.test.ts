import { beforeEach, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { ApiError, buildAccess } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildFilaments,
	buildParts,
	buildPlates,
	colorDesigns,
	member,
	organization,
	templates,
	user
} from '../db/schema';
import { onBuildEvents } from './test-helpers';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import {
	addRun,
	deleteBuild,
	printingAction,
	setPartStatus,
	undoRun,
	updateBuild
} from './actions';
import { createBuild } from './create';
import { loadBuildView } from './view';

let db: Db;
let templateId: string;
let orgId: string;

function addUser(id: string) {
	db.insert(user)
		.values({ id, name: `User ${id}`, email: `${id}@example.test` })
		.run();
}
function addMember(userId: string, role: string) {
	db.insert(member)
		.values({ id: `m-${userId}`, organizationId: orgId, userId, role, createdAt: new Date() })
		.run();
}

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	orgId = 'org1';
	db.insert(organization)
		.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	for (const u of ['owner', 'editor', 'viewer', 'outsider']) addUser(u);
	addMember('owner', 'owner');
	addMember('editor', 'editor');
	addMember('viewer', 'viewer');
});

const mk = (designId: string | null = null) =>
	createBuild(db, { organizationId: orgId, templateId, designId, name: 'Build A' }, 'owner');

describe('createBuild', () => {
	it('copies parts, plates and filaments from the template', () => {
		const tpl = templateSeeds[0];
		const id = mk();
		const n = (t: typeof buildParts | typeof buildPlates | typeof buildFilaments) =>
			db.select({ n: count() }).from(t).where(eq(t.buildId, id)).get()!.n;
		expect(n(buildParts)).toBe(tpl.parts.length);
		expect(n(buildPlates)).toBe(tpl.plates.length);
		expect(n(buildFilaments)).toBe(tpl.filamentRoles.length);
		expect(tpl.parts.length).toBe(33);
		expect(tpl.plates.length).toBe(24);
		expect(tpl.filamentRoles.length).toBe(4);
	});

	it('applies design overrides and part roles', () => {
		const d = db.select().from(colorDesigns).get()!;
		const id = mk(d.id);
		const view = loadBuildView(db, id, 'owner')!;
		for (const r of d.roles) {
			const f = view.filaments.find((x) => x.key === r.key)!;
			expect([f.name, f.material, f.hex]).toEqual([r.name, r.material, r.hex]);
			expect(f.spools).toBe(f.recommendedSpools);
		}
		for (const [slug, role] of Object.entries(d.partRoles)) {
			expect(view.parts.find((p) => p.slug === slug)!.role).toBe(role);
		}
	});

	it('rejects viewers and non-members', () => {
		const input = { organizationId: orgId, templateId, designId: null, name: 'x' };
		expect(() => createBuild(db, input, 'viewer')).toThrow(ApiError);
		expect(() => createBuild(db, input, 'outsider')).toThrow(ApiError);
	});
});

describe('loadBuildView', () => {
	it('is null for non-members, canEdit false for viewers', () => {
		const id = mk();
		expect(loadBuildView(db, id, 'outsider')).toBeNull();
		expect(buildAccess(db, id, 'outsider')).toBeNull();
		const v = loadBuildView(db, id, 'viewer')!;
		expect(v.role).toBe('viewer');
		expect(v.canEdit).toBe(false);
		expect(loadBuildView(db, id, 'editor')!.canEdit).toBe(true);
		expect(Object.keys(v.state)).toHaveLength(33);
		expect(v.members).toHaveLength(3);
	});
});

describe('mutations', () => {
	it('rejects viewers (403) and non-members (404), allows editors', () => {
		const id = mk();
		const slug = loadBuildView(db, id, 'owner')!.parts[0].slug;
		const status = (u: string) => () => setPartStatus(db, id, u, slug, { status: 'Printing' });
		expect(status('viewer')).toThrowError(expect.objectContaining({ status: 403 }));
		expect(status('outsider')).toThrowError(expect.objectContaining({ status: 404 }));
		status('editor')();
		expect(loadBuildView(db, id, 'owner')!.state[slug].status).toBe('Printing');
		const acts = db.select().from(activity).where(eq(activity.buildId, id)).all();
		expect(acts.map((a) => a.kind)).toContain('part.status');
	});

	it('emits an event per mutation', () => {
		const id = mk();
		const events = onBuildEvents(id);
		const slug = loadBuildView(db, id, 'owner')!.parts[0].slug;
		setPartStatus(db, id, 'editor', slug, { status: 'Printed' });
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ type: 'changed', kind: 'part.status', by: 'User editor' });
	});

	it('validates input', () => {
		const id = mk();
		expect(() => setPartStatus(db, id, 'owner', 'nope', { status: 'Printed' })).toThrow(ApiError);
		expect(() => setPartStatus(db, id, 'owner', 'x', { status: 'Bogus' })).toThrow(ApiError);
		expect(() => updateBuild(db, id, 'owner', { phase: 'nope' })).toThrow(ApiError);
		updateBuild(db, id, 'editor', { phase: 'printing', name: 'Renamed' });
		expect(loadBuildView(db, id, 'owner')!.build).toMatchObject({
			phase: 'printing',
			name: 'Renamed'
		});
	});

	it('printing start/stop round-trips', () => {
		const id = mk();
		const slug = loadBuildView(db, id, 'owner')!.parts[0].slug;
		printingAction(db, id, 'owner', { action: 'start', slugs: [slug] });
		expect(loadBuildView(db, id, 'owner')!.state[slug].status).toBe('Printing');
		printingAction(db, id, 'owner', { action: 'setEstimate', slugs: [slug], seconds: 3600 });
		expect(loadBuildView(db, id, 'owner')!.state[slug].runEstSeconds).toBe(3600);
		printingAction(db, id, 'owner', { action: 'stop', slugs: [slug] });
		expect(loadBuildView(db, id, 'owner')!.state[slug].status).toBe('To print');
	});

	it('marks plate parts Printed after the required successful runs', () => {
		const id = mk();
		const v0 = loadBuildView(db, id, 'owner')!;
		const plate = v0.plates.find((p) => p.runs === 2 && !p.perPartRuns && p.parts.length)!;
		const log = () =>
			addRun(db, id, 'editor', {
				plateNumber: plate.number,
				partSlug: null,
				partSlugs: null,
				date: '2026-01-02',
				result: 'Success',
				grams: 100,
				hours: 2,
				printer: 'P1',
				note: ''
			});
		log();
		let v = loadBuildView(db, id, 'owner')!;
		expect(v.state[plate.parts[0]].status).toBe('Printing');
		expect(v.runs).toHaveLength(1);
		expect(v.runs[0].userName).toBe('User editor');
		log();
		v = loadBuildView(db, id, 'owner')!;
		for (const s of plate.parts) expect(v.state[s].status).toBe('Printed');
		expect(() =>
			addRun(db, id, 'viewer', { plateNumber: plate.number, date: '2026-01-02', result: 'Success' })
		).toThrowError(expect.objectContaining({ status: 403 }));
	});

	it('only owners can delete a build', () => {
		const id = mk();
		expect(() => deleteBuild(db, id, 'editor')).toThrowError(
			expect.objectContaining({ status: 403 })
		);
		deleteBuild(db, id, 'owner');
		expect(loadBuildView(db, id, 'owner')).toBeNull();
	});
});

describe('undoRun', () => {
	it('deletes the run and restores the snapshot, only for parts the run touches', () => {
		const id = mk();
		const view0 = loadBuildView(db, id, 'owner')!;
		const slug = view0.parts[0].slug;
		const other = view0.parts.find((p) => p.slug !== slug)!.slug;
		printingAction(db, id, 'owner', { action: 'start', slugs: [slug] });
		const before = loadBuildView(db, id, 'owner')!.state[slug];
		const snap = {
			slug,
			status: before.status,
			startedAt: before.startedAt,
			printedOn: before.printedOn,
			runEstSeconds: before.runEstSeconds,
			comps: before.comps
		};
		const runId = addRun(db, id, 'owner', {
			plateNumber: null,
			partSlug: slug,
			date: '2026-01-01',
			result: 'Success',
			grams: 10,
			hours: 1,
			note: ''
		});
		expect(loadBuildView(db, id, 'owner')!.state[slug].status).toBe('Printed');

		expect(() => undoRun(db, id, 'owner', runId, { parts: [{ ...snap, slug: other }] })).toThrow(
			ApiError
		);
		expect(() => undoRun(db, id, 'viewer', runId, { parts: [snap] })).toThrow(ApiError);
		undoRun(db, id, 'owner', runId, { parts: [snap] });
		const after = loadBuildView(db, id, 'owner')!;
		expect(after.runs).toHaveLength(0);
		expect(after.state[slug].status).toBe('Printing');
		expect(after.state[slug].startedAt).toBe(before.startedAt);
		expect(after.activity[0].kind).toBe('run.undo');
	});
});
