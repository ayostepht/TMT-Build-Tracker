import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb, runMigrations } from './db';
import { templateModels, templatePartPlacements, templates } from './db/schema';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';
import { hasNonStepSource, kitStatus } from './kit-status';

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const HANDLE = 'push-handle-one-piece';

describe('hasNonStepSource', () => {
	it('is true only for a named non-STEP source', () => {
		expect(hasNonStepSource('TMT_SinglePIecehandle.stl')).toBe(true);
		expect(hasNonStepSource('3DTMT XX PUSH HANDLE PIN REV B.STEP')).toBe(false);
		expect(hasNonStepSource('part.stp')).toBe(false);
		expect(hasNonStepSource('')).toBe(false);
	});
});

describe('kitStatus missing parts', () => {
	async function setup(slugs: string[], placed: string[]) {
		const dir = mkdtempSync(join(tmpdir(), `tmt-ks-${process.pid}-`));
		process.env.DATABASE_URL = join(dir, 'tmt.db');
		const db = openDb(process.env.DATABASE_URL);
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		const tid = db.select().from(templates).where(eq(templates.slug, templateSeeds[0].slug)).get()!
			.id;
		db.insert(templateModels)
			.values({
				templateId: tid,
				glbPath: 'x.glb',
				version: 'v1',
				slugs,
				sourceNote: 'STEP import'
			})
			.run();
		db.update(templatePartPlacements)
			.set({ placed: false })
			.where(eq(templatePartPlacements.templateId, tid))
			.run();
		for (const slug of placed) {
			db.insert(templatePartPlacements)
				.values({ templateId: tid, slug, matrix: I, instances: [], placed: true })
				.onConflictDoUpdate({
					target: [templatePartPlacements.templateId, templatePartPlacements.slug],
					set: { placed: true }
				})
				.run();
		}
		return { db, tid };
	}

	it('does not ask for a STEP for the one-piece handle (STL source)', async () => {
		const { db, tid } = await setup(['push-grip'], [HANDLE]);
		const s = await kitStatus(db, tid);
		expect(s.model?.missing).not.toContain('Push Handle (one piece)');
	});

	it('still reports a placed STEP part with no node', async () => {
		const { db, tid } = await setup(['push-grip'], ['tires']);
		const s = await kitStatus(db, tid);
		expect(s.model?.missing).toContain('Tires');
	});
});
