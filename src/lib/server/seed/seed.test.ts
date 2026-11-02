import { count } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb, runMigrations } from '../db';
import { templateParts, templatePlates, templates, colorDesigns } from '../db/schema';
import { templateSeeds } from './index';
import { seedTemplates } from './run';

describe('seedTemplates', () => {
	it('is idempotent', () => {
		const db = openDb(':memory:');
		runMigrations(db);

		const first = seedTemplates(db, templateSeeds);
		expect(first.inserted).toEqual(templateSeeds.map((s) => s.slug));
		const snapshot = () => ({
			t: db.select({ n: count() }).from(templates).get()!.n,
			p: db.select({ n: count() }).from(templateParts).get()!.n,
			pl: db.select({ n: count() }).from(templatePlates).get()!.n,
			d: db.select({ n: count() }).from(colorDesigns).get()!.n
		});
		const a = snapshot();
		expect(a.t).toBe(templateSeeds.length);
		expect(a.p).toBe(templateSeeds.reduce((n, s) => n + s.parts.length, 0));

		const second = seedTemplates(db, templateSeeds);
		expect(second.inserted).toEqual([]);
		expect(snapshot()).toEqual(a);
	});
});
