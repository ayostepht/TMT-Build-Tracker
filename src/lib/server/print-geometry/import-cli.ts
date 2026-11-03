/**
 * Entry point for `scripts/import-print-geometry.mjs`. Bundled on its own by
 * `vite.cli.config.ts` into `build/cli/geometry-cli.js` (no SvelteKit runtime), so the CLI
 * stores exactly what the kit admin page stores (rows in `template_print_geometry`, meshes
 * under `<db dir>/uploads/print/<templateId>/`).
 */
import { asc, eq, or } from 'drizzle-orm';
import { openDb, runMigrations, type Db } from '../db';
import { templates } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { importPrintGeometry, listPrintGeometry, type ImportResult } from './import';

export { openDb };

/** Migrate and seed the templates (what the server does at start); for fresh scratch databases. */
export function initDb(db: Db): void {
	runMigrations(db);
	seedTemplates(db, templateSeeds);
}

export function listTemplates(db: Db) {
	return db
		.select({ id: templates.id, slug: templates.slug, name: templates.name })
		.from(templates)
		.orderBy(asc(templates.name))
		.all();
}

export function findTemplate(db: Db, slugOrId: string) {
	const t = db
		.select({ id: templates.id, slug: templates.slug, name: templates.name })
		.from(templates)
		.where(or(eq(templates.slug, slugOrId), eq(templates.id, slugOrId)))
		.get();
	if (!t)
		throw new Error(
			`No template "${slugOrId}". Known: ${
				listTemplates(db)
					.map((x) => x.slug)
					.join(', ') || 'none'
			}`
		);
	return t;
}

export async function importFiles(
	db: Db,
	templateId: string,
	files: string[]
): Promise<{ file: string; result: ImportResult }[]> {
	const out: { file: string; result: ImportResult }[] = [];
	for (const file of files) {
		const name = file.split(/[\\/]/).pop() ?? file;
		out.push({ file, result: await importPrintGeometry(db, templateId, file, name) });
	}
	return out;
}

export { listPrintGeometry };
