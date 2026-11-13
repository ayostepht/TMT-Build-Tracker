/**
 * Entry point for `scripts/build-kit-pack.mjs`, bundled by `vite.cli.config.ts` into
 * `build/cli/kitpack-cli.js`. Maintainer tooling: import the kit into a scratch database, then
 * write a kit pack from it.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { templateHardwarePath } from '../config';
import { templateParts } from '../db/schema';
import { convertStepZip } from '../models/convert';
import { templateModels } from '../db/schema';
import { templateModelPath } from '../config';
import { findTemplate, importFiles, initDb, listPrintGeometry } from '../print-geometry/import-cli';
import { openDb, type Db } from '../db';

export { buildKitPack } from './build';
export { addModelNodeFrom3mf, applyProjectSettings } from './model-node';
export { installKitPacks } from './install';
export { findTemplate, importFiles, initDb, listPrintGeometry, openDb };
export type { Db };

/** Convert a STEP zip into the template's GLB and register it (what the kit admin upload does). */
export async function convertModel(
	db: Db,
	templateId: string,
	zipPath: string,
	onProgress: (pct: number, message: string) => void
): Promise<{ slugs: number; missing: number; failed: number }> {
	const parts = db
		.select({
			slug: templateParts.slug,
			sourceFile: templateParts.sourceFile,
			components: templateParts.components
		})
		.from(templateParts)
		.where(eq(templateParts.templateId, templateId))
		.orderBy(asc(templateParts.sort))
		.all();
	const result = await convertStepZip(zipPath, { id: templateId, parts }, onProgress);
	const sourceNote = `${zipPath.split('/').pop()}: ${result.slugs.length} parts`;
	const values = {
		glbPath: templateModelPath(templateId),
		version: result.version,
		size: result.size,
		slugs: result.slugs,
		sourceNote
	};
	db.insert(templateModels)
		.values({ templateId, ...values })
		.onConflictDoUpdate({
			target: templateModels.templateId,
			set: { ...values, createdAt: new Date() }
		})
		.run();
	return {
		slugs: result.slugs.length,
		missing: result.report.filter((r) => r.status === 'missing').length,
		failed: result.report.filter((r) => r.status === 'failed').length
	};
}

/** Copy a hardware GLB (from `scripts/step-to-glb.mjs`) next to the model. */
export function registerHardware(templateId: string, glbPath: string): number {
	const buf = readFileSync(glbPath);
	if (buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('Not a GLB file');
	const dest = templateHardwarePath(templateId);
	mkdirSync(dirname(dest), { recursive: true });
	copyFileSync(glbPath, dest);
	return buf.length;
}
