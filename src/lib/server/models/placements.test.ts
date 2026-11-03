import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import { templatePartPlacements, templateParts, templates } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { applyPlacementPatch, IDENTITY, parsePlacementPatch } from './placements';

const m = (x = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

describe('parsePlacementPatch', () => {
	it('accepts matrix, instances and placed', () => {
		const p = parsePlacementPatch({ matrix: m(5), instances: [m(1), m(2)], placed: true });
		expect(p.instances).toHaveLength(2);
		expect(p.placed).toBe(true);
	});
	it.each([
		['not an object', 'x'],
		['empty', {}],
		['unknown key', { matrix: m(), foo: 1 }],
		['short matrix', { matrix: [1, 2, 3] }],
		['NaN', { matrix: [...m().slice(0, 15), NaN] }],
		['Infinity', { matrix: [...m().slice(0, 15), Infinity] }],
		['string number', { matrix: [...m().slice(0, 15), '1'] }],
		['huge value', { matrix: [...m().slice(0, 12), 1e12, 0, 0, 1] }],
		['bad instance', { instances: [m(), [1]] }],
		['instances not array', { instances: 'x' }],
		['65 instances', { instances: Array.from({ length: 65 }, () => m()) }],
		['placed not boolean', { placed: 'yes' }]
	])('rejects %s', (_n, body) => {
		expect(() => parsePlacementPatch(body)).toThrowError(ApiError);
	});
	it('allows exactly 64 instances', () => {
		expect(
			parsePlacementPatch({ instances: Array.from({ length: 64 }, () => m()) }).instances
		).toHaveLength(64);
	});
});

describe('applyPlacementPatch', () => {
	let db: Db;
	let tid: string;
	beforeEach(() => {
		db = openDb(':memory:');
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		tid = db.select().from(templates).get()!.id;
	});
	it('creates a row for a part without one and merges later patches', () => {
		const slug = db.select().from(templateParts).where(eq(templateParts.templateId, tid)).get()!
			.slug;
		db.delete(templatePartPlacements).where(eq(templatePartPlacements.slug, slug)).run();
		const a = applyPlacementPatch(db, tid, slug, { placed: true }, null);
		expect(a).toEqual({ slug, matrix: IDENTITY, instances: [], placed: true });
		const b = applyPlacementPatch(db, tid, slug, { matrix: m(7) }, null);
		expect(b.matrix[12]).toBe(7);
		expect(b.placed).toBe(true);
	});
	it('404s for a slug that is not a part of the template', () => {
		expect(() => applyPlacementPatch(db, tid, 'nope', { placed: true }, null)).toThrowError(
			expect.objectContaining({ status: 404 })
		);
	});
});
