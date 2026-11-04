import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError } from '../access';
import { createBuild } from '../builds/create';
import { loadBuildView } from '../builds/view';
import { openDb, runMigrations, type Db } from '../db';
import {
	member,
	organization,
	templateParts,
	templatePlateLayouts,
	templatePlates,
	templatePrintGeometry,
	templates,
	user
} from '../db/schema';
import { assertTemplateAdmin } from '../models/guard';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import {
	canManageTemplate,
	chooseBuildTemplate,
	defaultTemplate,
	forkTemplate,
	listTemplatesFor
} from './fork';

let db: Db;
let baseId: string;

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	baseId = defaultTemplate(db).id;
	for (const [id, name] of [
		['admin', 'Admin'],
		['owner', 'Owner'],
		['editor', 'Editor'],
		['viewer', 'Viewer'],
		['other', 'Other']
	])
		db.insert(user)
			.values({
				id,
				name,
				email: `${id}@example.test`,
				createdAt: new Date(id === 'admin' ? 1 : 2)
			})
			.run();
	for (const org of ['org1', 'org2'])
		db.insert(organization).values({ id: org, name: org, slug: org, createdAt: new Date() }).run();
	for (const [u, org, role] of [
		['owner', 'org1', 'owner'],
		['editor', 'org1', 'editor'],
		['viewer', 'org1', 'viewer'],
		['other', 'org2', 'owner']
	])
		db.insert(member)
			.values({ id: `m-${u}`, organizationId: org, userId: u, role, createdAt: new Date() })
			.run();
});

describe('forkTemplate', () => {
	it('copies the static data into a workspace-owned template', () => {
		const id = forkTemplate(db, 'org1', baseId, 'My chair');
		const fork = db.select().from(templates).where(eq(templates.id, id)).get()!;
		expect(fork.ownerOrgId).toBe('org1');
		expect(fork.baseTemplateId).toBe(baseId);
		expect(fork.slug).not.toBe(defaultTemplate(db).slug);
		const count = (t: typeof templateParts | typeof templatePlates | typeof templatePlateLayouts) =>
			db.select().from(t).where(eq(t.templateId, id)).all().length;
		const baseCount = (
			t: typeof templateParts | typeof templatePlates | typeof templatePlateLayouts
		) => db.select().from(t).where(eq(t.templateId, baseId)).all().length;
		expect(count(templateParts)).toBe(baseCount(templateParts));
		expect(count(templatePlates)).toBe(baseCount(templatePlates));
		expect(count(templatePlateLayouts)).toBe(baseCount(templatePlateLayouts));
		// Seed footprints come along, imported meshes do not.
		const geo = db
			.select()
			.from(templatePrintGeometry)
			.where(eq(templatePrintGeometry.templateId, id))
			.all();
		expect(geo.length).toBeGreaterThan(0);
		expect(geo.every((g) => g.sourceNote === 'seed')).toBe(true);
	});

	it('forks the original kit when asked to fork a fork', () => {
		const a = forkTemplate(db, 'org1', baseId, 'A');
		const b = forkTemplate(db, 'org1', a, 'B');
		expect(db.select().from(templates).where(eq(templates.id, b)).get()!.baseTemplateId).toBe(
			baseId
		);
	});

	it('lists global templates plus the workspace own, hides other workspaces', () => {
		const mine = forkTemplate(db, 'org1', baseId, 'Mine');
		const theirs = forkTemplate(db, 'org2', baseId, 'Theirs');
		const ids = (org: string) => listTemplatesFor(db, org).map((t) => t.id);
		expect(ids('org1')).toContain(mine);
		expect(ids('org1')).not.toContain(theirs);
		expect(ids('org1')).toContain(baseId);
		expect(defaultTemplate(db).id).toBe(baseId);
	});
});

describe('who may add kit files', () => {
	it('global kits: site admins only; own copies: owners and editors of that workspace', () => {
		const fork = forkTemplate(db, 'org1', baseId, 'Mine');
		const u = (id: string) => ({ id, email: `${id}@example.test` });
		expect(canManageTemplate(db, u('admin'), baseId)).toBe(true);
		for (const id of ['owner', 'editor', 'viewer', 'other'])
			expect(canManageTemplate(db, u(id), baseId)).toBe(false);
		expect(canManageTemplate(db, u('owner'), fork)).toBe(true);
		expect(canManageTemplate(db, u('editor'), fork)).toBe(true);
		for (const id of ['viewer', 'other']) {
			expect(canManageTemplate(db, u(id), fork)).toBe(false);
			expect(() => assertTemplateAdmin(db, u(id), fork)).toThrow(ApiError);
		}
		expect(() => assertTemplateAdmin(db, u('editor'), fork)).not.toThrow();
		expect(() => assertTemplateAdmin(db, u('editor'), baseId)).toThrow(ApiError);
		expect(canManageTemplate(db, u('owner'), 'missing')).toBe(false);
	});
});

describe('chooseBuildTemplate', () => {
	const mk = () =>
		createBuild(
			db,
			{ organizationId: 'org1', templateId: baseId, designId: null, name: 'Chair', setup: true },
			'owner'
		);

	it('switches a build to its own copy and back, keeping parts and progress', () => {
		const id = mk();
		const before = loadBuildView(db, id, 'owner')!;
		expect(before.build.setupStep).toBe(1);
		expect(before.build.templateOwned).toBe(false);

		const { templateId } = chooseBuildTemplate(db, id, 'owner', true);
		expect(templateId).not.toBe(baseId);
		const own = loadBuildView(db, id, 'owner')!;
		expect(own.build.templateOwned).toBe(true);
		expect(own.parts.map((p) => p.slug)).toEqual(before.parts.map((p) => p.slug));
		expect(own.plates.length).toBe(before.plates.length);

		// A second call reuses the copy.
		expect(chooseBuildTemplate(db, id, 'owner', true).templateId).toBe(templateId);
		expect(chooseBuildTemplate(db, id, 'owner', false).templateId).toBe(baseId);
		expect(chooseBuildTemplate(db, id, 'owner', true).templateId).toBe(templateId);
		expect(listTemplatesFor(db, 'org1').filter((t) => t.ownerOrgId).length).toBe(1);
	});

	it('needs an editor', () => {
		const id = mk();
		expect(() => chooseBuildTemplate(db, id, 'viewer', true)).toThrow(ApiError);
		expect(() => chooseBuildTemplate(db, id, 'other', true)).toThrow(ApiError);
	});
});
