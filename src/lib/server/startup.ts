import { backfillBuildParts } from './builds/backfill';
import { getDb, runMigrations } from './db';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';

let done = false;

/** Run migrations, reconcile template seeds, then backfill build rows. Safe to call repeatedly. */
export function startup(): void {
	if (done) return;
	const db = getDb();
	runMigrations(db);
	const { inserted, updated } = seedTemplates(db, templateSeeds);
	if (inserted.length) console.log(`[tmt] seeded templates: ${inserted.join(', ')}`);
	if (updated.length) console.log(`[tmt] updated templates: ${updated.join(', ')}`);
	const added = backfillBuildParts(db);
	if (added) console.log(`[tmt] added ${added} part rows to existing builds`);
	done = true;
}
