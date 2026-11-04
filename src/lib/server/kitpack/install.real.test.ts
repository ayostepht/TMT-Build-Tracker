// Runs only when TMT_KITPACK points at a built kit pack (never in git, never in CI). Installs it into
// a fresh database under the OS temp dir and checks the result the way a first start would.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { unzipSync } from 'fflate';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { boxOrients, type FitPiece } from '#lib/domain/geom2d.ts';
import { decodeMesh } from '../print-geometry/mesh-format';
import { INDEX_FORMAT, parseManifest, sha256Hex } from './format';

const packFile = process.env.TMT_KITPACK;

describe.skipIf(!packFile || !existsSync(packFile))('the real kit pack', () => {
	it(
		'installs into a fresh database: model, 40/40 print geometry, paint, X/P/A parts fit 256 x 256',
		{ timeout: 600_000 },
		async () => {
			const bytes = readFileSync(packFile!);
			const manifest = parseManifest(
				JSON.parse(
					new TextDecoder().decode(
						unzipSync(new Uint8Array(bytes), { filter: (f) => f.name === 'manifest.json' })[
							'manifest.json'
						]
					)
				)
			);
			const geometryRows = JSON.parse(
				new TextDecoder().decode(
					unzipSync(new Uint8Array(bytes), { filter: (f) => f.name === 'print/geometry.json' })[
						'print/geometry.json'
					]
				)
			) as { slug: string; origin: string }[];
			const dir = mkdtempSync(join(tmpdir(), 'tmt-kp-real-'));
			const packs = join(dir, 'packs');
			mkdirSync(packs);
			writeFileSync(
				join(packs, 'index.json'),
				JSON.stringify({
					format: INDEX_FORMAT,
					packs: [
						{
							slug: manifest.templateSlug,
							version: manifest.version,
							file: basename(packFile!),
							sha256: sha256Hex(bytes),
							size: bytes.length
						}
					]
				})
			);
			writeFileSync(join(packs, basename(packFile!)), bytes);
			process.env.DATABASE_URL = join(dir, 'tmt.db');
			const { openDb, runMigrations } = await import('../db');
			const schema = await import('../db/schema');
			const { templateSeeds } = await import('../seed');
			const { seedTemplates } = await import('../seed/run');
			const { installKitPacks } = await import('./install');
			const { listPrintGeometry } = await import('../print-geometry/import');
			const { loadFootprints } = await import('../builds/arrange-plan');
			const { kitStatus } = await import('../kit-status');
			const { printDir } = await import('../print-geometry/store');
			const { templateModelPath, templateHardwarePath } = await import('../config');

			const db = openDb(process.env.DATABASE_URL);
			runMigrations(db);
			seedTemplates(db, templateSeeds);
			const tpl = db
				.select()
				.from(schema.templates)
				.where(eq(schema.templates.slug, manifest.templateSlug))
				.get()!;
			const out = await installKitPacks(db, { dir: packs, download: false });
			expect(out[0].status).toBe('installed');

			// model + hardware
			expect(
				db
					.select()
					.from(schema.templateModels)
					.where(eq(schema.templateModels.templateId, tpl.id))
					.get()
			).toBeDefined();
			expect(existsSync(templateModelPath(tpl.id))).toBe(true);
			expect(existsSync(templateHardwarePath(tpl.id))).toBe(manifest.contents.hardware);
			const status = await kitStatus(db, tpl.id);
			expect(status.model?.rendered).toBeGreaterThan(30);
			expect(status.installing).toBe(false);

			// print geometry: every part, all from the pack
			const rows = listPrintGeometry(db, tpl.id);
			expect(rows.length).toBe(40);
			expect(rows.filter((r) => r.source.startsWith('kitpack:') && r.hasMesh).length).toBe(40);
			expect(status.print.withGeometry).toBe(40);

			// painted faces equal the import's (counted in the pack manifest at build time)
			const fps = loadFootprints(db, tpl.id);
			let painted = 0;
			for (const fp of fps.values())
				for (const pc of fp.pieces)
					painted += (
						decodeMesh(readFileSync(join(printDir(tpl.id), pc.mesh!))).paint ?? []
					).filter((p) => p.kind === 'supports').length;
			expect(painted).toBe(manifest.contents.paintedFaces);
			expect(rows.reduce((a, r) => a + r.paintedFaces, 0)).toBe(manifest.contents.paintedFaces);

			// no poses came back, and every X/P/A part fits flat on a 256 x 256 bed
			const xpa = geometryRows.filter((r) => /tmt_4691/i.test(r.origin)).map((r) => r.slug);
			expect(xpa.length).toBeGreaterThan(10);
			const U = 254;
			for (const slug of xpa)
				for (const pc of fps.get(slug)!.pieces) {
					expect(pc.orient?.poses ?? []).toEqual([]);
					const fits = boxOrients(pc as FitPiece, true, U, U).some((o) => o.w <= U && o.d <= U);
					expect(fits, `${slug} ${pc.name} ${pc.w}x${pc.d}`).toBe(true);
				}
		}
	);
});
