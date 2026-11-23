// Runs only when KITPACK_DIR points at the kit pack directory (never in CI). Prints wall time and the
// longest event-loop block of the arrange and export paths on the Centauri Carbon, for comparing branches.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

const dir = process.env.KITPACK_DIR;

describe.skipIf(!dir || !existsSync(dir!))('arrange timing against the real kit pack', () => {
	it('times the paths', { timeout: 900_000 }, async () => {
		process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-real-')), 'real.db');
		const { openDb, runMigrations } = await import('../db');
		const schema = await import('../db/schema');
		const { templateSeeds } = await import('../seed');
		const { seedTemplates } = await import('../seed/run');
		const { installKitPacks } = await import('../kitpack/install');
		const { createBuild } = await import('./create');
		const { arrangeForPrinter } = await import('./plates');
		const { updateBuildDesign } = await import('../designs/mutate');
		const { previewExport, exportBuild3mf } = await import('../threemf-export/index');
		const { catalogPrinter } = await import('#lib/printers/catalog.ts');
		const { printerFromCatalog } = await import('#lib/printers/printer.ts');
		const db = openDb(':memory:');
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		await installKitPacks(db, { dir: dir!, download: false });
		const tpl = db.select().from(schema.templates).get()!;
		db.insert(schema.organization)
			.values({ id: 'o', name: 'S', slug: 's', createdAt: new Date() })
			.run();
		db.insert(schema.user)
			.values({ id: 'u', name: 'S', email: 's@example.test', createdAt: new Date() })
			.run();
		db.insert(schema.member)
			.values({ id: 'm', organizationId: 'o', userId: 'u', role: 'owner', createdAt: new Date() })
			.run();
		const printer = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);
		const rows: string[] = [];
		async function time<T>(label: string, f: () => T | Promise<T>): Promise<T> {
			const h = monitorEventLoopDelay({ resolution: 1 });
			h.enable();
			const t = performance.now();
			const r = await f();
			const wall = performance.now() - t;
			h.disable();
			rows.push(
				`${label.padEnd(34)} wall ${wall.toFixed(0).padStart(6)} ms   max loop block ${(h.max / 1e6).toFixed(0).padStart(6)} ms`
			);
			return r;
		}
		const mk = (name: string) =>
			createBuild(
				db,
				{ organizationId: 'o', templateId: tpl.id, designId: null, name, printer },
				'u'
			);
		await time('warm-up create', () => mk('warm'));
		const id = await time('create build (default path)', () => mk('B'));
		await time('arrange for my bed (re-arrange)', () =>
			arrangeForPrinter(db, id, 'u', { convertRuns: true })
		);
		await time('auto re-arrange after recolor', () =>
			updateBuildDesign(db, id, 'u', { partRoles: { 'seat-back-top': 'accent' } })
		);
		await time('export preview', () => previewExport(db, id, 'u', { flavor: 'orca' }));
		await time('export.3mf (orca, stream drained)', async () => {
			const out = exportBuild3mf(db, id, 'u', { flavor: 'orca' });
			const rd = out.stream.getReader();
			for (;;) if ((await rd.read()).done) break;
		});
		// the same arrange-for-bed result is identical every time: a digest to compare branches
		const { buildArrangement } = await import('./plates');
		const info = buildArrangement(db, id, 'u');
		const { createHash } = await import('node:crypto');
		rows.push(
			'plates ' +
				info.plates.length +
				' digest ' +
				createHash('sha256')
					.update(
						JSON.stringify(
							info.plates.map((p) => [
								p.number,
								p.parts,
								p.items.map((i) => [i.slug, i.piece, i.x, i.y, i.rotation])
							])
						)
					)
					.digest('hex')
					.slice(0, 12)
		);
		if (process.env.TMT_PLATE_TIMES) {
			const { loadBuildView } = await import('./view');
			const { loadFootprints, planArrangement, loadKitSource } = await import('./arrange-plan');
			const view = loadBuildView(db, id, 'u')!;
			const fps = loadFootprints(db, tpl.id);
			const kit = loadKitSource(db, view)!;
			for (const pl of kit.plates!) {
				const one = { ...kit, plates: [pl] };
				const v2 = { ...view, parts: view.parts };
				const t = performance.now();
				planArrangement(v2, fps, null, undefined, one);
				const ms = performance.now() - t;
				if (ms > 30) rows.push(`  plate ${pl.number} ${pl.name}: ${ms.toFixed(0)} ms`);
			}
		}
		expect(rows.length).toBeGreaterThan(0);
		console.log('\nTIMING\n' + rows.join('\n'));
	});

	// Request cost: what a GET of the arrangement and an export cost per build state and bed. Each read is
	// timed twice (the second read shows what a cache saves).
	it('times buildArrangement and the export per build state', { timeout: 900_000 }, async () => {
		process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-real-')), 'real.db');
		const { openDb, runMigrations } = await import('../db');
		const schema = await import('../db/schema');
		const { templateSeeds } = await import('../seed');
		const { seedTemplates } = await import('../seed/run');
		const { installKitPacks } = await import('../kitpack/install');
		const { createBuild } = await import('./create');
		const { buildArrangement, setPlateLayout } = await import('./plates');
		const { loadBuildView } = await import('./view');
		const { clearPlanCache, loadFootprints, loadKitSource, planArrangement, writePlan } =
			await import('./arrange-plan');
		const { previewExport, exportBuild3mf } = await import('../threemf-export/index');
		const { catalogPrinter } = await import('#lib/printers/catalog.ts');
		const { printerFromCatalog } = await import('#lib/printers/printer.ts');
		const { and, eq } = await import('drizzle-orm');
		const db = openDb(':memory:');
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		await installKitPacks(db, { dir: dir!, download: false });
		const tpl = db.select().from(schema.templates).get()!;
		db.insert(schema.organization)
			.values({ id: 'o', name: 'S', slug: 's', createdAt: new Date() })
			.run();
		db.insert(schema.user)
			.values({ id: 'u', name: 'S', email: 's@example.test', createdAt: new Date() })
			.run();
		db.insert(schema.member)
			.values({ id: 'm', organizationId: 'o', userId: 'u', role: 'owner', createdAt: new Date() })
			.run();
		const rows: string[] = [];
		const ms = (f: () => unknown) => {
			const t = performance.now();
			f();
			return performance.now() - t;
		};
		// the first read of each state starts with an empty plan cache: a cold request
		const cold = <T>(f: () => T): T => {
			clearPlanCache();
			return f();
		};
		const line = (label: string, first: number, second: number) =>
			rows.push(
				`${label.padEnd(46)} first ${first.toFixed(0).padStart(6)} ms   second ${second.toFixed(0).padStart(6)} ms`
			);
		for (const [bedName, catalogId, layoutKey] of [
			['Centauri Carbon 256', 'elegoo-centauri-carbon', 'xpa'],
			['Bambu H2D', 'bambu-lab-h2d', 'h2d']
		] as const) {
			const printer = printerFromCatalog(catalogPrinter(catalogId)!, 0);
			const mk = (name: string) =>
				createBuild(
					db,
					{ organizationId: 'o', templateId: tpl.id, designId: null, name, printer },
					'u'
				);
			mk('warm');
			// (a) arranged by the current planner
			const a = mk('a');
			line(
				`${bedName}: buildArrangement, v3 arranged`,
				ms(() => cold(() => buildArrangement(db, a, 'u'))),
				ms(() => buildArrangement(db, a, 'u'))
			);
			// (b) arranged before planner versions existed: no `v`, the legacy planner's own output
			const b = mk('b');
			const vb = loadBuildView(db, b, 'u')!;
			const legacy = planArrangement(vb, loadFootprints(db, tpl.id), null, undefined, 'legacy')!;
			writePlan(db, b, legacy);
			for (const r of db
				.select()
				.from(schema.buildPlates)
				.where(eq(schema.buildPlates.buildId, b))
				.all()) {
				const rest = Object.fromEntries(
					Object.entries(r.arrangement as object).filter(([k]) => k !== 'v')
				);
				db.update(schema.buildPlates)
					.set({ arrangement: rest as never })
					.where(and(eq(schema.buildPlates.buildId, b), eq(schema.buildPlates.number, r.number)))
					.run();
			}
			line(
				`${bedName}: buildArrangement, version-less`,
				ms(() => cold(() => buildArrangement(db, b, 'u'))),
				ms(() => buildArrangement(db, b, 'u'))
			);
			// (c) not arranged: a kit layout chosen
			const c = mk('c');
			const key = db
				.select()
				.from(schema.templatePlateLayouts)
				.where(eq(schema.templatePlateLayouts.templateId, tpl.id))
				.all()
				.find((l) => l.key === layoutKey)?.key;
			if (key) {
				setPlateLayout(db, c, 'u', { key, convertRuns: true });
				line(
					`${bedName}: buildArrangement, unarranged (${key})`,
					ms(() => cold(() => buildArrangement(db, c, 'u'))),
					ms(() => buildArrangement(db, c, 'u'))
				);
				line(
					`${bedName}: export preview, unarranged`,
					ms(() => cold(() => previewExport(db, c, 'u', { flavor: 'orca' }))),
					ms(() => previewExport(db, c, 'u', { flavor: 'orca' }))
				);
			}
			// exports of the arranged build and of the stale one (version-less, colour changed: re-plans)
			line(
				`${bedName}: export preview, v3 arranged`,
				ms(() => cold(() => previewExport(db, a, 'u', { flavor: 'orca' }))),
				ms(() => previewExport(db, a, 'u', { flavor: 'orca' }))
			);
			const t = performance.now();
			const out = exportBuild3mf(db, a, 'u', { flavor: 'orca' });
			const rd = out.stream.getReader();
			for (;;) if ((await rd.read()).done) break;
			rows.push(
				`${bedName}: export.3mf, v3 arranged (drained)`.padEnd(46) +
					` ${(performance.now() - t).toFixed(0)} ms`
			);
			void loadKitSource;
			clearPlanCache();
		}
		expect(rows.length).toBeGreaterThan(0);
		console.log('\nREQUEST COST\n' + rows.join('\n'));
	});
});
