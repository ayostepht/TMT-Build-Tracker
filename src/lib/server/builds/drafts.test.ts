import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError, buildAccess } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import { activity, builds, member, organization, printerJobs, templates, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import {
	addRun,
	deleteBuild,
	printingAction,
	promoteDraft,
	setPartStatus,
	setSetupStep,
	updateBuild,
	updateFilament
} from './actions';
import { setAssemblyItem } from './assembly';
import { createBuild } from './create';
import { updateHandoff } from './handoff';
import { buildRows, draftRows, recentBuilds } from './list';
import { updateBuildDesign } from '../designs/mutate';
import { loadBuildView } from './view';

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

const mkDraft = (name = 'Draft 1') =>
	createBuild(
		db,
		{ organizationId: orgId, templateId, designId: null, name, kind: 'draft' },
		'editor'
	);
const mkBuild = (name = 'Build A') =>
	createBuild(db, { organizationId: orgId, templateId, designId: null, name }, 'owner');
const rejected = (fn: () => void) => {
	try {
		fn();
	} catch (e) {
		expect(e).toBeInstanceOf(ApiError);
		expect((e as ApiError).status).toBe(400);
		return;
	}
	throw new Error('expected a 400');
};

describe('Studio drafts: lists and stats', () => {
	it('creates a draft with no setup step and kind draft', () => {
		const id = mkDraft();
		const row = db.select().from(builds).where(eq(builds.id, id)).get()!;
		expect(row.kind).toBe('draft');
		expect(row.setupStep).toBeNull();
		expect(buildAccess(db, id, 'owner')?.kind).toBe('draft');
		expect(loadBuildView(db, id, 'owner')!.build.kind).toBe('draft');
	});

	it('keeps drafts out of build rows and the recent builds menu', () => {
		const b = mkBuild();
		const d = mkDraft();
		expect(buildRows(db, [orgId]).map((r) => r.id)).toEqual([b]);
		expect(recentBuilds(db, [orgId]).map((r) => r.id)).toEqual([b]);
		expect(draftRows(db, [orgId]).map((r) => r.id)).toEqual([d]);
		expect(draftRows(db, [orgId])[0].colors.length).toBeGreaterThan(0);
	});

	it('shows no builds when only drafts exist', () => {
		mkDraft();
		expect(buildRows(db, [orgId])).toEqual([]);
		expect(recentBuilds(db, [orgId])).toEqual([]);
	});
});

describe('Studio drafts: tracking mutations are refused', () => {
	it('rejects runs, status, printing, filament stock, assembly, handoff, phase and setup with a 400', () => {
		const id = mkDraft();
		const v = loadBuildView(db, id, 'editor')!;
		const slug = v.parts[0].slug;
		const plate = v.plates[0];
		rejected(() => setPartStatus(db, id, 'editor', slug, { status: 'Printed' }));
		rejected(() => printingAction(db, id, 'editor', { action: 'start', slugs: [slug] }));
		rejected(() =>
			addRun(db, id, 'editor', {
				plateNumber: plate.number,
				partSlug: null,
				partSlugs: null,
				date: '2026-01-02',
				result: 'Success',
				grams: 10,
				hours: 1,
				printer: 'P1',
				note: ''
			})
		);
		rejected(() => updateFilament(db, id, 'editor', v.filaments[0].key, { spools: 3 }));
		rejected(() =>
			setAssemblyItem(db, id, 'editor', v.assembly.steps[0]?.key ?? 'x', { done: true })
		);
		rejected(() => updateHandoff(db, id, 'editor', { notes: 'hi' }));
		rejected(() => updateBuild(db, id, 'editor', { phase: 'printing' }));
		rejected(() => setSetupStep(db, id, 'editor', { step: 2 }));
		const after = loadBuildView(db, id, 'editor')!;
		expect(after.runs).toHaveLength(0);
		expect(after.state[slug].status).toBe(v.state[slug].status);
		// Nothing leaked into the activity log besides the create row.
		expect(db.select().from(activity).where(eq(activity.buildId, id)).all()).toHaveLength(1);
	});

	it('still allows design, name and filament colour edits', () => {
		const id = mkDraft();
		const v = loadBuildView(db, id, 'editor')!;
		updateFilament(db, id, 'editor', v.filaments[0].key, { hex: '#112233' });
		updateBuild(db, id, 'editor', { name: 'Renamed' });
		const part = v.parts.find((p) => p.slug === 'wing-left')!;
		updateBuildDesign(db, id, 'editor', { partRoles: { [part.slug]: 'primary' } });
		const after = loadBuildView(db, id, 'editor')!;
		expect(after.build.name).toBe('Renamed');
		expect(after.filaments[0].hex).toBe('#112233');
		expect(after.parts.find((p) => p.slug === part.slug)!.role).toBe('primary');
	});

	it('viewers still get a 403 and builds still accept tracking', () => {
		const id = mkDraft();
		expect(() => updateBuild(db, id, 'viewer', { name: 'x' })).toThrow(/cannot edit/);
		const b = mkBuild();
		const slug = loadBuildView(db, b, 'owner')!.parts[0].slug;
		setPartStatus(db, b, 'editor', slug, { status: 'Printed' });
		expect(loadBuildView(db, b, 'owner')!.state[slug].status).toBe('Printed');
	});

	it('does not link printer jobs to drafts', () => {
		const id = mkDraft();
		expect(db.select().from(printerJobs).all()).toHaveLength(0);
		expect(buildAccess(db, id, 'owner')?.kind).toBe('draft');
	});
});

describe('Studio drafts: delete and promote', () => {
	it('lets an editor delete a draft but not a build, and removes its rows', () => {
		const d = mkDraft();
		deleteBuild(db, d, 'editor');
		expect(db.select().from(builds).where(eq(builds.id, d)).all()).toHaveLength(0);
		const b = mkBuild();
		expect(() => deleteBuild(db, b, 'editor')).toThrow(/owners/);
	});

	it('promotes a draft: keeps design and plates, becomes a build, writes activity', () => {
		const id = mkDraft('Keeper');
		const v = loadBuildView(db, id, 'editor')!;
		updateFilament(db, id, 'editor', v.filaments[0].key, { hex: '#abcdef' });
		const plates = v.plates.length;
		promoteDraft(db, id, 'editor');
		const row = db.select().from(builds).where(eq(builds.id, id)).get()!;
		expect(row.kind).toBe('build');
		expect(row.setupStep).toBe(5);
		const after = loadBuildView(db, id, 'editor')!;
		expect(after.filaments[0].hex).toBe('#abcdef');
		expect(after.plates).toHaveLength(plates);
		expect(after.activity.some((a) => a.kind === 'build.promote')).toBe(true);
		expect(buildRows(db, [orgId]).map((r) => r.id)).toEqual([id]);
		expect(draftRows(db, [orgId])).toEqual([]);
		// Now it tracks like any build.
		const slug = after.parts[0].slug;
		setPartStatus(db, id, 'editor', slug, { status: 'Printed' });
	});

	it('refuses to promote a build, and viewers cannot promote', () => {
		rejected(() => promoteDraft(db, mkBuild(), 'owner'));
		expect(() => promoteDraft(db, mkDraft(), 'viewer')).toThrow(/cannot edit/);
	});
});
