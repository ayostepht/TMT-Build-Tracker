import { backfillBuildParts } from './builds/backfill';
import { failStaleModelJobs, kickQueue } from './models/jobs';
import { getDb, runMigrations } from './db';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';
import { startSupervisor } from './printers/supervisor';

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
	const stale = failStaleModelJobs(db);
	if (stale) console.log(`[tmt] marked ${stale} interrupted 3D model job(s) as failed`);
	kickQueue(db);
	if (process.env.TMT_PRINTERS !== 'off') startSupervisor(db);
	done = true;
}
