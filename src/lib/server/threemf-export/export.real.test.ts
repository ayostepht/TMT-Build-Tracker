// Runs only when TMT_REAL_DB points at a scratch database whose print geometry was imported with
// scripts/import-print-geometry.mjs (never the user's data, never in CI). Creates a build with the
// Elegoo Centauri Carbon, arranges it, writes the three flavors to TMT_REAL_OUT and reports stats.
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { printerFromCatalog } from '#lib/printers/printer.ts';

const dbFile = process.env.TMT_REAL_DB;
const out = resolve(process.env.TMT_REAL_OUT ?? 'data/export-check');

describe.skipIf(!dbFile || !existsSync(dbFile))('export of the real H profile geometry', () => {
	it(
		'arranges, exports orca + bambu + plain, parses its own files',
		{ timeout: 600_000 },
		async () => {
			process.env.DATABASE_URL = resolve(dbFile!);
			const { openDb, runMigrations } = await import('../db');
			const schema = await import('../db/schema');
			const { createBuild } = await import('../builds/create');
			const { arrangeForPrinter } = await import('../builds/plates');
			const { exportBuild3mf, previewExport } = await import('./index');
			const { parseThreeMfBytes } = await import('../threemf/index');
			const { unzipSync } = await import('fflate');
			const db = openDb(resolve(dbFile!));
			runMigrations(db);
			const tpl = db.select().from(schema.templates).get()!;
			if (!db.select().from(schema.organization).get()) {
				db.insert(schema.organization)
					.values({ id: 'org-real', name: 'Scratch', slug: 'scratch', createdAt: new Date() })
					.run();
				db.insert(schema.user)
					.values({
						id: 'u-real',
						name: 'Scratch',
						email: 'scratch@example.test',
						createdAt: new Date()
					})
					.run();
				db.insert(schema.member)
					.values({
						id: 'm-real',
						organizationId: 'org-real',
						userId: 'u-real',
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
				{ organizationId: org.id, templateId: tpl.id, designId: null, name: 'Real check', printer },
				uid
			);
			const arr = arrangeForPrinter(db, id, uid, { convertRuns: true });
			console.log('ARRANGED plates', arr.plates, 'warnings', arr.warnings.length);
			mkdirSync(out, { recursive: true });
			const stats: string[] = [];
			for (const flavor of ['orca', 'bambu', 'plain'] as const) {
				const pre = previewExport(db, id, uid, { flavor });
				const t0 = Date.now();
				let peak = process.memoryUsage().rss;
				const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
				const res = exportBuild3mf(db, id, uid, { flavor });
				const file = join(out, res.filename);
				await pipeline(Readable.fromWeb(res.stream as never), createWriteStream(file));
				clearInterval(timer);
				const ms = Date.now() - t0;
				const size = statSync(file).size;
				const objs = pre.plates.reduce((a, p) => a + p.items, 0);
				stats.push(
					`${flavor}: ${res.filename} ${(size / 1e6).toFixed(1)} MB, ${ms} ms, peak RSS ${Math.round(peak / 1e6)} MB, plates ${pre.plates.length}, items ${objs}, warnings ${pre.warnings.length}, missing ${pre.missing.length}`
				);
				// round trip
				const bytes = new Uint8Array(readFileSync(file));
				if (flavor === 'plain') {
					const z = unzipSync(bytes);
					const inner = Object.keys(z).filter((n) => n.endsWith('.3mf'));
					expect(inner).toHaveLength(pre.plates.length);
					let n = 0;
					for (const f of inner) {
						const s = await parseThreeMfBytes(z[f]);
						n += s.plates[0].objects.reduce((a, o) => a + o.count, 0);
					}
					expect(n).toBe(objs);
				} else {
					const s = await parseThreeMfBytes(bytes);
					expect(s.plates).toHaveLength(pre.plates.length);
					expect(s.plates.reduce((a, p) => a + p.objects.reduce((b, o) => b + o.count, 0), 0)).toBe(
						objs
					);
					expect(s.filaments).toHaveLength(pre.filaments.length);
					stats.push(
						`  filaments ${JSON.stringify(s.filaments.map((f) => [f.index, f.type, f.color]))}`
					);
				}
				if (flavor === 'orca')
					stats.push(
						'  plates: ' +
							pre.plates.map((p) => `${p.number}:${p.name}[${p.items}]`).join(' | ') +
							'\n  warnings: ' +
							pre.warnings.map((w) => w.message).join(' | ') +
							'\n  missing: ' +
							pre.missing.map((m) => m.slug).join(',')
					);
			}
			console.log('REALSTATS\n' + stats.join('\n'));
		}
	);
});
