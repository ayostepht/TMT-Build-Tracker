import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyPlacementPatch } from '../models/placements';
import { openDb, runMigrations, type Db } from '../db';
import { templatePartPlacements, templates, user } from '../db/schema';
import { tmtTemplate } from './tmt';
import { seedTemplates, shouldUpdatePlacement } from './run';

const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const moved = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 9, 9, 9, 1];

describe('shouldUpdatePlacement', () => {
	const seed = { slug: 'x', matrix: moved, instances: [ID], placed: true };
	const row = { matrix: moved, instances: [ID], placed: true, updatedBy: null };
	it('leaves an identical row alone', () => {
		expect(shouldUpdatePlacement(row, seed)).toBe(false);
	});
	it('updates a differing row nobody edited', () => {
		expect(shouldUpdatePlacement({ ...row, matrix: ID }, seed)).toBe(true);
		expect(shouldUpdatePlacement({ ...row, instances: [] }, seed)).toBe(true);
		expect(shouldUpdatePlacement({ ...row, placed: false }, seed)).toBe(true);
	});
	it('never touches a row an admin edited', () => {
		expect(shouldUpdatePlacement({ ...row, matrix: ID, updatedBy: 'u1' }, seed)).toBe(false);
	});
	it('treats a seed without a matrix as identity', () => {
		expect(
			shouldUpdatePlacement(
				{ matrix: ID, instances: [], placed: false, updatedBy: null },
				{ slug: 'x', placed: false }
			)
		).toBe(false);
	});
});

describe('placement reconcile on startup', () => {
	let db: Db;
	let tid: string;
	const rowOf = (slug: string) =>
		db
			.select()
			.from(templatePartPlacements)
			.where(and(eq(templatePartPlacements.templateId, tid), eq(templatePartPlacements.slug, slug)))
			.get()!;
	beforeEach(() => {
		db = openDb(':memory:');
		runMigrations(db);
		seedTemplates(db, [tmtTemplate]);
		tid = db.select().from(templates).get()!.id;
	});

	it('every seeded part has a row and the new parts are placed', () => {
		for (const s of ['push-grip', 'soft-headrest', 'tires', 'rims-1-4', 'front-caster-mount'])
			expect(rowOf(s).placed, s).toBe(true);
		expect(rowOf('tires').instances).toHaveLength(15);
		expect(rowOf('harness').placed).toBe(false); // procedural stand-in, not a STEP placement
	});

	it('moves an unedited placement to the new seed value', () => {
		// Simulate an older seed: tires unplaced at identity, written by the seed (no editor).
		db.update(templatePartPlacements)
			.set({ matrix: ID, instances: [], placed: false })
			.where(eq(templatePartPlacements.slug, 'tires'))
			.run();
		seedTemplates(db, [tmtTemplate]);
		const r = rowOf('tires');
		expect(r.placed).toBe(true);
		expect(r.instances).toHaveLength(15);
		expect(r.updatedBy).toBeNull();
	});

	it('never overwrites an admin edit', () => {
		db.insert(user).values({ id: 'adm', name: 'Adm', email: 'adm@example.test' }).run();
		applyPlacementPatch(db, tid, 'push-grip', { matrix: moved, placed: true }, 'adm');
		const second = seedTemplates(db, [tmtTemplate]);
		expect(rowOf('push-grip').matrix).toEqual(moved);
		expect(rowOf('push-grip').updatedBy).toBe('adm');
		expect(second.updated).not.toContain(tmtTemplate.slug);
	});

	it('is idempotent: a second run changes nothing', () => {
		expect(seedTemplates(db, [tmtTemplate]).updated).toEqual([]);
	});
});
