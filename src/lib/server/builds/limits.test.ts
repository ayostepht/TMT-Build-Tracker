import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, runMigrations, type Db } from '../db';
import { builds, member, organization, templates, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { addRun, updateBuild } from './actions';
import { createBuild } from './create';
import { BUILD_HOSPITAL_MAX, BUILD_NAME_MAX, BUILD_RECIPIENT_MAX, PART_SLUG_MAX } from './limits';

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
	db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.test' }).run();
	db.insert(member)
		.values({
			id: 'm-owner',
			organizationId: orgId,
			userId: 'owner',
			role: 'owner',
			createdAt: new Date()
		})
		.run();
});

const create = (extra: Record<string, unknown> = {}) =>
	createBuild(
		db,
		{ organizationId: orgId, templateId, designId: null, name: 'B', ...extra } as never,
		'owner'
	);
const row = (id: string) => db.select().from(builds).where(eq(builds.id, id)).get()!;

describe('build free-text caps', () => {
	it('create: trims a long name to the cap, refuses long recipient and hospital', () => {
		const id = create({ name: 'n'.repeat(BUILD_NAME_MAX + 50) });
		expect(row(id).name).toHaveLength(BUILD_NAME_MAX);
		expect(() => create({ recipient: 'r'.repeat(BUILD_RECIPIENT_MAX + 1) })).toThrow(
			/recipient must be text of at most 200 characters/
		);
		expect(() => create({ hospital: 'h'.repeat(BUILD_HOSPITAL_MAX + 1) })).toThrow(
			/hospital must be text of at most 200 characters/
		);
		expect(() => create({ name: 42 })).toThrow(/Name is required/);
		const ok = create({
			recipient: ` ${'r'.repeat(BUILD_RECIPIENT_MAX)}`.slice(0, BUILD_RECIPIENT_MAX),
			hospital: '  '
		});
		expect(row(ok).recipient).toHaveLength(BUILD_RECIPIENT_MAX - 1);
		expect(row(ok).hospital).toBeNull();
	});

	it('update: same caps for name, recipient and hospital', () => {
		const id = create();
		updateBuild(db, id, 'owner', { name: 'x'.repeat(BUILD_NAME_MAX + 1) });
		expect(row(id).name).toHaveLength(BUILD_NAME_MAX);
		updateBuild(db, id, 'owner', { recipient: 'r'.repeat(BUILD_RECIPIENT_MAX) });
		expect(row(id).recipient).toHaveLength(BUILD_RECIPIENT_MAX);
		expect(() =>
			updateBuild(db, id, 'owner', { recipient: 'r'.repeat(BUILD_RECIPIENT_MAX + 1) })
		).toThrow(/at most 200 characters/);
		expect(() =>
			updateBuild(db, id, 'owner', { hospital: 'h'.repeat(BUILD_HOSPITAL_MAX + 1) })
		).toThrow(/at most 200 characters/);
	});

	it('a run refuses an over-long part slug before looking it up', () => {
		const id = create();
		expect(() =>
			addRun(db, id, 'owner', { partSlug: 'p'.repeat(PART_SLUG_MAX + 1), outcome: 'success' })
		).toThrow(/partSlug must be text of at most 200 characters/);
	});
});
