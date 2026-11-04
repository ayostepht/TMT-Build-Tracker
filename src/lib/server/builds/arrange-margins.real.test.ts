// Runs only when TMT_MG_DB names a scratch database (under the repo's gitignored data/); never in CI.
// Installs the repo's kit pack (KITPACK_DIR=<repo>/kitpacks), arranges the TMT for the Centauri Carbon
// with and without the layout optimiser, prints per plate min edge clearance before -> after and the
// rotations that changed, runs the export guard on the real meshes and leaves the arranged plates in
// the database for screenshots.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitOutline } from '#lib/domain/geom2d.ts';
import { layoutMetrics, type OptItem } from '#lib/domain/plate-optimize.ts';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { printerFromCatalog } from '#lib/printers/printer.ts';

const dbFile = process.env.TMT_MG_DB;

describe.skipIf(!dbFile)('layout margins on the real kit geometry', () => {
	it('arranges before/after and the export guard stays clean', { timeout: 900_000 }, async () => {
		process.env.DATABASE_URL = resolve(dbFile!);
		process.env.KITPACK_DIR = resolve('kitpacks');
		const { openDb, runMigrations } = await import('../db');
		const schema = await import('../db/schema');
		const { seedTemplates } = await import('../seed/run');
		const { templateSeeds } = await import('../seed');
		const { installKitPacks } = await import('../kitpack/install');
		const { createBuild } = await import('./create');
		const { loadBuildView } = await import('./view');
		const { planArrangement, loadFootprints } = await import('./arrange-plan');
		const { arrangeForPrinter } = await import('./plates');
		const { previewExport } = await import('../threemf-export/index');
		const db = openDb(resolve(dbFile!));
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		console.log('INSTALL', JSON.stringify(await installKitPacks(db, { dir: resolve('kitpacks') })));
		const tpl = db.select().from(schema.templates).get()!;
		if (!db.select().from(schema.organization).get()) {
			db.insert(schema.organization)
				.values({ id: 'org-mg', name: 'Scratch', slug: 'scratch', createdAt: new Date() })
				.run();
			db.insert(schema.user)
				.values({ id: 'u-mg', name: 'Scratch', email: 'mg@example.test', createdAt: new Date() })
				.run();
			db.insert(schema.member)
				.values({
					id: 'm-mg',
					organizationId: 'org-mg',
					userId: 'u-mg',
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
			{ organizationId: org.id, templateId: tpl.id, designId: null, name: 'Margins', printer },
			uid
		);
		const view = loadBuildView(db, id, uid)!;
		const fps = loadFootprints(db, view.build.templateId);
		const t0 = performance.now();
		const before = planArrangement(view, fps, null, { optimize: false })!;
		const t1 = performance.now();
		const after = planArrangement(view, fps, null)!;
		const t2 = performance.now();
		planArrangement(view, fps, null);
		const t3 = performance.now();
		console.log('WARM optimiser run', Math.round(t3 - t2), 'ms');
		console.log(
			`TIMING packer ${Math.round(t1 - t0)} ms, packer+optimiser ${Math.round(t2 - t1)} ms`
		);
		expect(after.result.plates.length).toBe(before.result.plates.length);
		if (process.env.TMT_MG_DEBUG) {
			const { boxOrients, turnedOutlineBox } = await import('#lib/domain/geom2d.ts');
			const { findFreePosition } = await import('#lib/domain/plate-optimize.ts');
			for (const slug of ['wing-right', 'wing-left']) {
				const pc = fps.get(slug)!.pieces[0];
				const outline = fitOutline(pc);
				for (const margin of [0, 1]) {
					const ux = 256 - 2 * margin;
					const os = boxOrients(pc, true, ux, ux);
					console.log(
						'DBG',
						slug,
						'margin',
						margin,
						'box',
						pc.w,
						pc.d,
						'hull',
						outline.length,
						'orients',
						JSON.stringify(os)
					);
					for (const o of os) {
						const b = turnedOutlineBox(outline, o.rot);
						const st = { bedX: 256, bedY: 256, margin, spacing: 8, keepOut: printer.keepOut };
						const a = findFreePosition(
							outline,
							o.rot,
							st,
							o.ox !== undefined ? { ox: o.ox, oy: o.oy! } : undefined
						);
						const n = findFreePosition(
							outline,
							o.rot,
							{ ...st, keepOut: [] },
							o.ox !== undefined ? { ox: o.ox, oy: o.oy! } : undefined
						);
						console.log(
							'DBG  rot',
							o.rot,
							'bbox',
							b.w.toFixed(2),
							b.d.toFixed(2),
							'with zone',
							JSON.stringify(a),
							'no zone',
							JSON.stringify(n)
						);
					}
				}
			}
		}
		const setup = {
			bedX: printer.bedX,
			bedY: printer.bedY,
			margin: 1,
			spacing: printer.spacing,
			keepOut: printer.keepOut
		};
		const m = (pl: (typeof after.result.plates)[number]) => {
			const items: OptItem[] = pl.items.map((i) => ({
				outline: fitOutline(fps.get(i.slug)!.pieces[i.piece]),
				rotatable: false,
				rot: i.rotation,
				x: i.x,
				y: i.y,
				ox: i.ox,
				oy: i.oy,
				w: i.w,
				d: i.d
			}));
			return layoutMetrics(items, { ...setup, margin: pl.bed.margin });
		};
		const rows: string[] = [];
		after.result.plates.forEach((pl, k) => {
			const pb = before.result.plates[k];
			expect(pl.parts).toEqual(pb.parts);
			if (pl.oversize) return;
			const a = m(pb);
			const b = m(pl);
			const rot: string[] = [];
			pl.items.forEach((i, n) => {
				const o = pb.items[n];
				if (Math.abs(i.rotation - o.rotation) > 0.01)
					rot.push(`${i.slug} ${o.rotation}->${i.rotation}`);
			});
			rows.push(
				`PLATE ${pl.number} ${pl.name} (${pl.items.length} items): min clearance ${a.minClearance.toFixed(1)} -> ${b.minClearance.toFixed(1)} mm, min gap ${a.minGap === Infinity ? '-' : a.minGap.toFixed(1)} -> ${b.minGap === Infinity ? '-' : b.minGap.toFixed(1)}; rotations changed: ${rot.join(', ') || 'none'}`
			);
		});
		console.log(rows.join('\n'));
		if (process.env.TMT_MG_DEBUG)
			for (const [tag, res] of [
				['BEFORE', before],
				['AFTER', after]
			] as const)
				for (const pl of res.result.plates.filter((p) => /Seat Center/.test(p.name)))
					for (const i of pl.items)
						console.log(
							'SEAT',
							tag,
							i.slug,
							'rot',
							i.rotation,
							'xy',
							i.x,
							i.y,
							'box',
							i.w,
							i.d,
							'edges L/R/B/T',
							(i.x - i.w / 2 - 1).toFixed(1),
							(255 - i.x - i.w / 2).toFixed(1),
							(i.y - i.d / 2 - 1).toFixed(1),
							(255 - i.y - i.d / 2).toFixed(1)
						);
		console.log(
			'WARNINGS',
			JSON.stringify(after.result.warnings.map((w) => `${w.code}: ${w.message}`))
		);
		arrangeForPrinter(db, id, uid, { convertRuns: true });
		const pre = previewExport(db, id, uid, { flavor: 'orca' });
		const bad = pre.warnings.filter((w) => w.severity === 'error');
		console.log(
			'GUARD',
			pre.warnings.length,
			'warnings,',
			bad.length,
			'errors',
			JSON.stringify(pre.warnings.map((w) => w.message))
		);
		console.log('BUILD', id, 'DB', dbFile);
		expect(bad).toEqual([]);
		expect(existsSync(resolve(dbFile!))).toBe(true);
	});
});
