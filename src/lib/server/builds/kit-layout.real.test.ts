// Runs only when KITPACK_DIR points at a directory with the kit pack and its index.json (never in CI).
// The maintainer's report: on an Elegoo Centauri Carbon (256 x 256 + cutter keep-out) a standard-palette
// build got plates re-arranged and merged (Handle Left + Headrest Brace, Cushion Top + Soft Headrest,
// Cushion Base + Push Handle Grip) that are single-part plates in the kit's default layout.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = process.env.KITPACK_DIR;

describe.skipIf(!dir || !existsSync(dir!))('kit layout against the real kit pack', () => {
	it(
		'a standard-palette build keeps the kit plates; lone kit plates stay alone',
		{
			timeout: 900_000
		},
		async () => {
			process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-real-')), 'real.db');
			const { openDb, runMigrations } = await import('../db');
			const schema = await import('../db/schema');
			const { templateSeeds } = await import('../seed');
			const { seedTemplates } = await import('../seed/run');
			const { installKitPacks } = await import('../kitpack/install');
			const { createBuild } = await import('./create');
			const { buildArrangement } = await import('./plates');
			const { loadBuildView } = await import('./view');
			const { previewExport } = await import('../threemf-export/index');
			const { catalogPrinter } = await import('#lib/printers/catalog.ts');
			const { printerFromCatalog } = await import('#lib/printers/printer.ts');
			const db = openDb(':memory:');
			runMigrations(db);
			seedTemplates(db, templateSeeds);
			await installKitPacks(db, { dir: dir!, download: false });
			const tpl = db.select().from(schema.templates).get()!;
			db.insert(schema.organization)
				.values({ id: 'org-r', name: 'S', slug: 's', createdAt: new Date() })
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
			const printer = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);
			const id = createBuild(
				db,
				{ organizationId: 'org-r', templateId: tpl.id, designId: null, name: 'Std', printer },
				'u-r'
			);
			const kitId = createBuild(
				db,
				{
					organizationId: 'org-r',
					templateId: tpl.id,
					designId: null,
					name: 'Kit',
					printer,
					plateLayout: 'xpa'
				},
				'u-r'
			);
			const mine = buildArrangement(db, id, 'u-r').plates;
			const kit = loadBuildView(db, kitId, 'u-r')!.plates;
			const lone = kit.filter((p) => p.parts.length === 1);
			expect(lone.length).toBeGreaterThan(10);
			for (const k of lone) {
				const got = mine.find((p) => p.number === k.number)!;
				expect(got.parts, `plate ${k.number} ${k.name}`).toEqual(k.parts);
			}
			// the three plates of the report: alone, as in the kit
			for (const slug of ['handle-left', 'cushion-top', 'cushion-base'])
				expect(mine.find((p) => p.parts.includes(slug))!.parts).toEqual([slug]);
			// every kit plate is there, in the kit's number, with the kit's parts: 24 plates, none added
			expect(mine.length).toBe(kit.length);
			expect(mine.length).toBe(24);
			for (const k of kit)
				expect(mine.find((p) => p.number === k.number)?.parts, `plate ${k.number}`).toEqual(
					k.parts
				);
			// the wheel rims are ONE plate (one object printed in two colors): both parts, printed 2 times each,
			// with ONE rim on the bed
			const rims = mine.filter((p) => p.parts.some((s) => s.startsWith('rims-')));
			expect(rims).toHaveLength(1);
			expect(rims[0]).toMatchObject({
				number: 13,
				parts: ['rims-1-4', 'rims-2-3'],
				runs: 2,
				perPartRuns: true
			});
			expect(rims[0].items).toHaveLength(1);
			const out = mine.map((p) => `${p.number} ${p.name} [${p.parts.join(',')}]`).join('\n');
			console.log(`PLATES ${mine.length} (kit ${kit.length})\n${out}`);
			const pre = previewExport(db, id, 'u-r', { flavor: 'orca' });
			console.log(
				'EXPORT WARNINGS',
				JSON.stringify(pre.warnings.map((w) => w.severity + ':' + w.code))
			);
			expect(pre.warnings.filter((w) => w.severity === 'error')).toEqual([]);
			// the export of plate 13 is what ONE print of it holds: one rim, and a note about the other prints
			const p13 = pre.plates.find((p) => p.number === 13)!;
			expect(p13.items).toBe(1);
			expect(p13.runs).toBe(2);
			expect(pre.warnings.find((w) => w.plate === 13)?.message).toMatch(/one print/);
			expect(pre.plates.map((p) => p.number)).toEqual(mine.map((p) => p.number));
		}
	);
});

// Planner 3 against the real pack: the rims plate, the plates of the pack that are printed more than once,
// the densities that ground the crowding cap, a part that joins a plate, and v2 arrangements left alone.
describe.skipIf(!dir || !existsSync(dir!))('planner 3 against the real kit pack', () => {
	async function world() {
		process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-real-')), 'real.db');
		const { openDb, runMigrations } = await import('../db');
		const schema = await import('../db/schema');
		const { templateSeeds } = await import('../seed');
		const { seedTemplates } = await import('../seed/run');
		const { installKitPacks } = await import('../kitpack/install');
		const db = openDb(':memory:');
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		await installKitPacks(db, { dir: dir!, download: false });
		const tpl = db.select().from(schema.templates).get()!;
		db.insert(schema.organization)
			.values({ id: 'org-r', name: 'S', slug: 's', createdAt: new Date() })
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
		const { catalogPrinter } = await import('#lib/printers/catalog.ts');
		const { printerFromCatalog } = await import('#lib/printers/printer.ts');
		const { createBuild } = await import('./create');
		const build = (printerId: string, name: string, plateLayout?: string) =>
			createBuild(
				db,
				{
					organizationId: 'org-r',
					templateId: tpl.id,
					designId: null,
					name,
					printer: printerFromCatalog(catalogPrinter(printerId)!, 0),
					plateLayout
				},
				'u-r'
			);
		return { db, tpl, build };
	}

	it(
		'every multi-run plate of the pack is one plate, and the multi-part densities ground the cap',
		{ timeout: 900_000 },
		async () => {
			const { buildArrangement } = await import('./plates');
			const { loadBuildView } = await import('./view');
			const { JOIN_MAX_UTILISATION } = await import('#lib/domain/arrange-source.ts');
			const { db, build } = await world();
			for (const [printerId, layout] of [
				['elegoo-centauri-carbon', 'xpa'],
				['bambu-lab-h2d', 'h2d']
			] as const) {
				const id = build(printerId, printerId);
				const kitId = build(printerId, 'kit', layout);
				const mine = buildArrangement(db, id, 'u-r').plates;
				const kit = loadBuildView(db, kitId, 'u-r')!.plates;
				// every plate of the kit that is printed more than once, or per part, is one plate here too
				const multiRun = kit.filter((p) => p.runs > 1 || p.perPartRuns);
				console.log(
					`MULTIRUN ${printerId}: ` +
						multiRun
							.map(
								(p) =>
									`${p.number} ${p.name} [${p.parts.join(',')}] runs=${p.runs} perPart=${p.perPartRuns}`
							)
							.join(' | ')
				);
				for (const k of multiRun) {
					const got = mine.filter((p) => p.parts.some((s) => k.parts.includes(s)));
					expect(got, `plate ${k.number} ${k.name}`).toHaveLength(1);
					expect(got[0].number).toBe(k.number);
					expect(got[0].parts).toEqual(k.parts);
					expect(got[0].runs).toBe(k.runs);
				}
				if (printerId === 'elegoo-centauri-carbon') {
					// the author's own multi-part plates on the 256 bed: used share of the usable bed (boxes with brims)
					const dens = mine
						.filter(
							(p) =>
								p.number <= 24 &&
								!p.perPartRuns &&
								kit.find((k) => k.number === p.number)!.parts.length >= 2
						)
						.map((p) => ({
							n: p.number,
							name: p.name,
							parts: p.parts.length,
							util: p.utilisation
						}));
					console.log(
						'DENSITIES ' +
							dens
								.map((d) => `${d.n} ${d.name} (${d.parts} parts) ${Math.round(d.util * 100)}%`)
								.join(' | ')
					);
					const sorted = dens.map((d) => d.util).sort((a, b) => a - b);
					const median = (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
					console.log(
						`DENSITY median ${median} max ${sorted[sorted.length - 1]} cap ${JOIN_MAX_UTILISATION}`
					);
					// the cap sits at or just above the typical multi-part plate, below the fullest one
					expect(JOIN_MAX_UTILISATION).toBeGreaterThanOrEqual(median);
					expect(JOIN_MAX_UTILISATION).toBeLessThan(sorted[sorted.length - 1]);
					expect(JOIN_MAX_UTILISATION - median).toBeLessThanOrEqual(0.1);
				}
			}
		}
	);

	it(
		'a recolored part that must leave its plate joins a kit plate of its filament; v2 plates stay as they are',
		{ timeout: 900_000 },
		async () => {
			const { buildArrangement } = await import('./plates');
			const { loadBuildView } = await import('./view');
			const { updateBuildDesign } = await import('../designs/mutate');
			const { previewExport } = await import('../threemf-export/index');
			const { loadFootprints, loadKitSource, planArrangement, writePlan } =
				await import('./arrange-plan');
			const { JOIN_MAX_UTILISATION } = await import('#lib/domain/arrange-source.ts');
			const { db, tpl, build } = await world();
			const id = build('elegoo-centauri-carbon', 'Std');
			const before = buildArrangement(db, id, 'u-r').plates;
			// seat-back-top shares the primary "Seat Back" plate with the bottom half; Accent it and it leaves
			updateBuildDesign(db, id, 'u-r', { partRoles: { 'seat-back-top': 'accent' } });
			const info = buildArrangement(db, id, 'u-r');
			expect(info.stale).toBe(false);
			expect(info.plates).toHaveLength(24); // no new plate
			const home = info.plates.find((p) => p.parts.includes('seat-back-top'))!;
			expect(home.number).toBeLessThanOrEqual(24);
			expect(home.parts.length).toBeGreaterThanOrEqual(2);
			expect(home.roles).toEqual(['accent']);
			expect(home.utilisation).toBeLessThanOrEqual(JOIN_MAX_UTILISATION + 0.005);
			// the plate's own items did not move
			const was = before.find((p) => p.number === home.number)!;
			for (const w of was.items)
				expect(
					home.items.find((i) => i.slug === w.slug && i.piece === w.piece && i.copy === w.copy)
				).toEqual(w);
			console.log(
				`JOIN seat-back-top -> plate ${home.number} ${home.name} [${home.parts.join(',')}] util ${was.utilisation} -> ${home.utilisation}`
			);
			// the file and the Print tab agree
			const view = loadBuildView(db, id, 'u-r')!;
			const pre = previewExport(db, id, 'u-r', { flavor: 'orca' });
			expect(
				pre.plates.find((p) => p.objects.some((o) => o.slug === 'seat-back-top'))!.number
			).toBe(home.number);
			for (const p of pre.plates)
				expect([...new Set(p.objects.map((o) => o.slug))].sort()).toEqual(
					view.plates
						.find((x) => x.number === p.number)!
						.parts.filter((s) => p.objects.some((o) => o.slug === s))
						.sort()
				);
			// a build stored by planner 2 (25 plates: the rims split) is not stale and is not rewritten
			const id2 = build('elegoo-centauri-carbon', 'Old');
			const v = loadBuildView(db, id2, 'u-r')!;
			const fp = loadFootprints(db, tpl.id);
			const v2 = planArrangement(v, fp, null, undefined, loadKitSource(db, v)!, 2)!;
			expect(v2.result.plates).toHaveLength(25);
			writePlan(db, id2, v2, 2);
			const old = buildArrangement(db, id2, 'u-r');
			expect(old.plates).toHaveLength(25);
			expect(old.stale).toBe(false);
			expect(old.fresh!.plates).toBe(24);
		}
	);
});
