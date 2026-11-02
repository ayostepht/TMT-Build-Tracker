import { getDb, runMigrations } from './db';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';

let done = false;

/** Run migrations then seed templates. Safe to call repeatedly. */
export function startup(): void {
	if (done) return;
	const db = getDb();
	runMigrations(db);
	const { inserted } = seedTemplates(db, templateSeeds);
	if (inserted.length) console.log(`[tmt] seeded templates: ${inserted.join(', ')}`);
	done = true;
}
