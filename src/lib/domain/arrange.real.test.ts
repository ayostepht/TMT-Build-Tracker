// Runs only when TMT_XPA_3MF points at the user's X/P/A project 3MF (never in git, never in CI).
// Optional: TMT_H_3MF / TMT_BUCKET_3MF (the H profile and the bucket seat profile, imported first so
// the X/P/A file wins), TMT_REAL_OUT for the report. Imports the geometry into a scratch database
// under the repo's gitignored data/ (removed afterwards, same code as scripts/import-print-geometry.mjs).
//
// Oracle: every part placed in that file fits flat on a 256 x 256 bed, so the arranger must accept
// every piece with at most 1 mm margin, place all of them without an oversize plate, and the
// export guard (real meshes through the writer's transforms) must stay clean.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boxOrients, type FitPiece } from './geom2d.ts';

const xpa = process.env.TMT_XPA_3MF;
const imports = [process.env.TMT_H_3MF, process.env.TMT_BUCKET_3MF, xpa].filter(
	(f): f is string => !!f && existsSync(f)
);

describe.skipIf(!xpa || !existsSync(xpa))('arranger against the real X/P/A project', () => {
	it(
		'accepts and places every part of the file flat on 256 x 256',
		{ timeout: 1_200_000 },
		async () => {
			const dir = resolve('data/scratch/arrange-real-' + process.pid);
			mkdirSync(dir, { recursive: true });
			try {
				process.env.DATABASE_URL = resolve(dir, 'u.db');
				const { openDb, runMigrations } = await import('../server/db');
				const schema = await import('../server/db/schema');
				const { templateSeeds } = await import('../server/seed');
				const { seedTemplates } = await import('../server/seed/run');
				const { importPrintGeometry, listPrintGeometry } =
					await import('../server/print-geometry/import');
				const { loadFootprints } = await import('../server/builds/arrange-plan');
				const { createBuild } = await import('../server/builds/create');
				const { arrangeForPrinter } = await import('../server/builds/plates');
				const { previewExport } = await import('../server/threemf-export/index');
				const { catalogPrinter } = await import('../printers/catalog.ts');
				const { printerFromCatalog } = await import('../printers/printer.ts');
				const db = openDb(resolve(dir, 'u.db'));
				runMigrations(db);
				seedTemplates(db, templateSeeds);
				const tpl = db.select().from(schema.templates).get()!;
				for (const f of imports) {
					const name = f.split('/').pop()!;
					const res = await importPrintGeometry(db, tpl.id, f, name);
					console.log('IMPORTED', name, res.imported);
				}
				const xpaName = xpa!.split('/').pop()!;
				const mine = new Set(
					listPrintGeometry(db, tpl.id)
						.filter((r) => r.source === xpaName)
						.map((r) => r.slug)
				);
				expect(mine.size).toBeGreaterThan(10);
				const fps = loadFootprints(db, tpl.id);

				// 1. fitter on every piece of the file's parts, 256 bed, 1 mm margin
				const rows: string[] = [];
				const U = 254;
				for (const slug of [...mine].sort()) {
					for (const pc of fps.get(slug)!.pieces) {
						const fit = pc as FitPiece;
						const boxBest = Math.max(
							Math.min(246 - pc.w, 246 - pc.d),
							Math.min(246 - pc.d, 246 - pc.w)
						);
						const o = boxOrients(fit, true, U, U);
						const okFlat = o.some((x) => x.w <= U && x.d <= U);
						const best = o[0];
						rows.push(
							`${slug} | ${pc.w}x${pc.d} | fits=${okFlat} | rot=${best?.rot} | clearance before=${boxBest.toFixed(1)} after=${best ? Math.min(U - best.w, U - best.d).toFixed(1) : 'n/a'} | sil=${!!pc.sil}`
						);
						expect(okFlat, `${slug} (${pc.name}) ${pc.w}x${pc.d} must fit`).toBe(true);
					}
				}
				console.log('FITTABLE\n' + rows.join('\n'));
				if (process.env.TMT_REAL_OUT) writeFileSync(process.env.TMT_REAL_OUT, rows.join('\n'));

				// 2. full arranger + export guard
				if (!db.select().from(schema.organization).get()) {
					db.insert(schema.organization)
						.values({ id: 'org-r', name: 'Scratch', slug: 'scratch', createdAt: new Date() })
						.run();
					db.insert(schema.user)
						.values({ id: 'u-r', name: 'S', email: 's@example.test', createdAt: new Date() })
						.run();
					db.insert(schema.member)
						.values({
							id: 'm-r',
							organizationId: 'org-r',
							userId: 'u-r',
							role: 'owner',
							createdAt: new Date()
						})
						.run();
				}
				const org = db.select().from(schema.organization).get()!;
				const uid = db.select().from(schema.member).get()!.userId;
				const printer = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);
				const id = createBuild(
					db,
					{ organizationId: org.id, templateId: tpl.id, designId: null, name: 'Real', printer },
					uid
				);
				const arr = arrangeForPrinter(db, id, uid, { convertRuns: true });
				console.log(
					'ARRANGED plates',
					arr.plates,
					'warnings',
					JSON.stringify(
						arr.warnings.map((w: { code: string; slug: string }) => w.code + ':' + w.slug)
					)
				);
				const pre = previewExport(db, id, uid, { flavor: 'orca' });
				const over = arr.warnings.filter((w: { code: string }) => w.code === 'oversize');
				console.log('OVERSIZE', JSON.stringify(over.map((w: { slug: string }) => w.slug)));
				console.log('EXPORT WARNINGS', JSON.stringify(pre.warnings));
				const bad = (over as { slug: string }[]).filter((w) => mine.has(w.slug));
				expect(bad).toEqual([]);
				expect(pre.warnings.filter((w) => w.severity === 'error')).toEqual([]);
			} finally {
				try {
					rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
				} catch {
					// scratch dir under gitignored data/; leave it if busy
				}
			}
		}
	);
});
