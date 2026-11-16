import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDb, runMigrations, type Db } from '../db';
import {
	buildPartProfiles,
	buildPlates,
	buildUploads,
	builds,
	member,
	organization,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { createBuild } from './create';
import { remapRoleKey } from './role-keys';
import { loadBuildView } from './view';
import { updateBuildDesign } from '../designs/mutate';

let db: Db;
let id: string;
let other: string;

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	const templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: 'org1', name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.test' }).run();
	db.insert(member)
		.values({
			id: 'm1',
			organizationId: 'org1',
			userId: 'owner',
			role: 'owner',
			createdAt: new Date()
		})
		.run();
	id = createBuild(db, { organizationId: 'org1', templateId, designId: null, name: 'A' }, 'owner');
	other = createBuild(
		db,
		{ organizationId: 'org1', templateId, designId: null, name: 'B' },
		'owner'
	);
});

const plateGrams = (b: string, n: number) =>
	db
		.select()
		.from(buildPlates)
		.where(and(eq(buildPlates.buildId, b), eq(buildPlates.number, n)))
		.get()!.filamentGrams;

describe('remapRoleKey', () => {
	it('moves and sums grams in plates, part profiles and upload filament maps, only for its build', () => {
		for (const b of [id, other]) {
			db.insert(buildPlates)
				.values({ buildId: b, number: 90, name: 'P', filamentGrams: { x: 10, primary: 5 } })
				.run();
			db.insert(buildPlates)
				.values({ buildId: b, number: 91, name: 'Q', filamentGrams: { accent: 2 } })
				.run();
			db.insert(buildPartProfiles)
				.values({ buildId: b, partSlug: 'p1', source: 'manual', gramsByRole: { x: 4 } })
				.run();
			db.insert(buildUploads)
				.values({
					id: `u-${b}`,
					buildId: b,
					fileName: 'a.3mf',
					summary: { filamentMap: { '0': 'x', '1': 'accent', '2': null }, keep: 1 }
				})
				.run();
		}
		db.transaction((tx) => remapRoleKey(tx, id, 'x', 'primary'));

		expect(plateGrams(id, 90)).toEqual({ primary: 15 });
		expect(plateGrams(id, 91)).toEqual({ accent: 2 });
		expect(
			db.select().from(buildPartProfiles).where(eq(buildPartProfiles.buildId, id)).get()!
				.gramsByRole
		).toEqual({ primary: 4 });
		expect(
			db
				.select()
				.from(buildUploads)
				.where(eq(buildUploads.id, `u-${id}`))
				.get()!.summary
		).toEqual({
			filamentMap: { '0': 'primary', '1': 'accent', '2': null },
			keep: 1
		});
		// the other build is untouched
		expect(plateGrams(other, 90)).toEqual({ x: 10, primary: 5 });
		expect(
			db
				.select()
				.from(buildUploads)
				.where(eq(buildUploads.id, `u-${other}`))
				.get()!.summary
		).toMatchObject({ filamentMap: { '0': 'x' } });
	});

	it('is a no-op for from === to and for builds with nothing keyed from', () => {
		db.insert(buildPlates)
			.values({ buildId: id, number: 90, name: 'P', filamentGrams: { primary: 5 } })
			.run();
		db.transaction((tx) => {
			remapRoleKey(tx, id, 'primary', 'primary');
			remapRoleKey(tx, id, 'gone', 'primary');
		});
		expect(plateGrams(id, 90)).toEqual({ primary: 5 });
	});
});

describe('view contract: kit, defaultRole, locked', () => {
	it('flags kit slots, exposes defaultRole and reads lockedParts leniently', () => {
		const v0 = loadBuildView(db, id, 'owner')!;
		expect(v0.filaments.every((f) => f.kit)).toBe(true);
		expect(v0.allParts.every((p) => !p.locked && p.defaultRole)).toBe(true);
		const slug = v0.parts[0].slug;

		updateBuildDesign(db, id, 'owner', {
			addRole: { name: 'Extra', material: 'PETG', hex: '#123456' }
		});
		expect(loadBuildView(db, id, 'owner')!.filaments.filter((f) => !f.kit)).toHaveLength(1);

		const setLocked = (lockedParts: unknown) => {
			const row = db.select().from(builds).where(eq(builds.id, id)).get()!;
			db.update(builds)
				.set({ design: { ...(row.design as object), lockedParts } as never })
				.where(eq(builds.id, id))
				.run();
			return loadBuildView(db, id, 'owner')!;
		};
		const v1 = setLocked([slug, 'no-such-part', 5]);
		expect(v1.allParts.filter((p) => p.locked).map((p) => p.slug)).toEqual([slug]);
		expect(setLocked('oops').allParts.some((p) => p.locked)).toBe(false);
		expect(setLocked(null).allParts.some((p) => p.locked)).toBe(false);
	});
});
