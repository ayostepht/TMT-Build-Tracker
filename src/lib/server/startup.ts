import { backfillBuildParts } from './builds/backfill';
import { repairTwinPlates } from './builds/twin-repair';
import { failStaleModelJobs, kickQueue } from './models/jobs';
import { getDb, runMigrations } from './db';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';
import { startSupervisor } from './printers/supervisor';
import { sweepImportsDir } from './imports-sweep';
import { installKitPacks } from './kitpack/install';
import { cleanupAuthDataAtStartup } from './auth-cleanup';

let done = false;

/** Run migrations, reconcile template seeds, then backfill build rows. Safe to call repeatedly. */
export function startup(): void {
	if (done) return;
	const db = getDb();
	runMigrations(db);
	cleanupAuthDataAtStartup(db);
	const { inserted, updated } = seedTemplates(db, templateSeeds);
	if (inserted.length) console.log(`[tmt] seeded templates: ${inserted.join(', ')}`);
	if (updated.length) console.log(`[tmt] updated templates: ${updated.join(', ')}`);
	const added = backfillBuildParts(db);
	if (added) console.log(`[tmt] added ${added} part rows to existing builds`);
	try {
		const fixed = repairTwinPlates(db);
		if (fixed.length)
			console.log(`[tmt] repaired ${fixed.length} uploaded plate(s) with twin parts`);
	} catch (e) {
		console.error('[tmt] twin plate repair failed', e);
	}
	const stale = failStaleModelJobs(db);
	if (stale) console.log(`[tmt] marked ${stale} interrupted 3D model job(s) as failed`);
	sweepImportsDir(db)
		.then((n) => n && console.log(`[tmt] removed ${n} stale upload leftover(s) from imports`))
		.catch(() => {});
	kickQueue(db);
	// MakeGood's kit (CC0) from the baked-in or downloaded kit pack; in the background, never blocks start.
	installKitPacks(db).catch((e) => console.error('[tmt] kit pack install error', e));
	if (process.env.TMT_PRINTERS !== 'off') startSupervisor(db);
	done = true;
}
