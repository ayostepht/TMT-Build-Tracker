// Runs only when TMT_SLICED_3MF points at a sliced project (a `.gcode.3mf` exported from Elegoo/Orca
// with G-code for every plate; never in git). Parses it with the plate parser, prints a report
// (app, printer, per-plate time and grams, thumbnails, matching, parse time, peak memory) and, with
// KITPACK_DIR set, runs the whole upload -> review -> apply flow against a scratch database under data/.
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseThreeMfFile } from './index';

const file = process.env.TMT_SLICED_3MF;
const peakMb = () => Math.round(process.resourceUsage().maxRSS / 1024);

describe.skipIf(!file || !existsSync(file))('real sliced project', () => {
	it(
		'reads times, grams and thumbnails of every plate without inflating G-code',
		{ timeout: 120_000 },
		async () => {
			const rssBefore = peakMb();
			const t0 = performance.now();
			const s = await parseThreeMfFile(file!);
			const ms = Math.round(performance.now() - t0);
			const lines = [
				`file ${(statSync(file!).size / 1e6).toFixed(1)} MB, parsed in ${ms} ms, peak RSS ${peakMb()} MB (before ${rssBefore} MB)`,
				`app ${s.app}; printer ${s.printer}; nozzle ${s.nozzle}; layer ${s.layerHeight}; sliced ${s.sliced}; kind ${s.kind}`,
				`filaments ${s.filaments.map((f) => `#${f.index} ${f.type} ${f.color} ${f.name ?? ''}`).join(' | ')}`,
				`warnings ${JSON.stringify(s.warnings)}`
			];
			for (const p of s.plates)
				lines.push(
					`plate ${p.index} "${p.name}" ${p.estSeconds}s ${p.grams}g fg=${JSON.stringify(p.filamentGrams)} thumb=${p.thumbnail ? p.thumbnail.length : 'none'} objects=${p.objects.map((o) => `${o.name}x${o.count}`).join(', ')}`
				);
			console.log(lines.join('\n'));
			expect(s.kind).toBe('project');
			expect(s.sliced).toBe(true);
			expect(s.plates.length).toBeGreaterThan(0);
			for (const p of s.plates) {
				expect(p.estSeconds).toBeGreaterThan(0);
				expect(p.grams).toBeGreaterThan(0);
				expect(Object.keys(p.filamentGrams).length).toBeGreaterThan(0);
				expect(p.thumbnail?.length ?? 0).toBeGreaterThan(100);
			}
			expect(ms).toBeLessThan(60_000);
		}
	);

	it.skipIf(!process.env.KITPACK_DIR)(
		'upload, review and apply on an arranged and an unarranged build',
		{ timeout: 900_000 },
		async () => {
			const work = resolve(process.env.TMT_SLICED_DB ?? 'data/scratch/sliced-real-' + Date.now());
			mkdirSync(work, { recursive: true });
			process.env.DATABASE_URL = resolve(work, 'tmt.db');
			const { openDb, runMigrations } = await import('../db');
			const schema = await import('../db/schema');
			const { templateSeeds } = await import('../seed');
			const { seedTemplates } = await import('../seed/run');
			const { installKitPacks } = await import('../kitpack/install');
			const { createBuild } = await import('../builds/create');
			const { applyUpload, createUpload } = await import('../builds/plates');
			const { loadBuildView } = await import('../builds/view');
			const { timeStats } = await import('#lib/domain/accounting.ts');
			const { catalogPrinter } = await import('#lib/printers/catalog.ts');
			const { printerFromCatalog } = await import('#lib/printers/printer.ts');
			const db = openDb(process.env.DATABASE_URL);
			runMigrations(db);
			seedTemplates(db, templateSeeds);
			console.log(
				'INSTALL',
				JSON.stringify(
					await installKitPacks(db, { dir: process.env.KITPACK_DIR!, download: false })
				)
			);
			const tpl = db.select().from(schema.templates).get()!;
			db.insert(schema.organization)
				.values({ id: 'org-s', name: 'Scratch', slug: 'scratch', createdAt: new Date() })
				.run();
			db.insert(schema.user)
				.values({ id: 'u-s', name: 'S', email: 's@example.test', createdAt: new Date() })
				.run();
			db.insert(schema.member)
				.values({
					id: 'm-s',
					organizationId: 'org-s',
					userId: 'u-s',
					role: 'owner',
					createdAt: new Date()
				})
				.run();
			const printer = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);
			const summary = await parseThreeMfFile(file!);
			for (const [label, withPrinter] of [
				['arranged', true],
				['unarranged', false]
			] as const) {
				const id = createBuild(
					db,
					{
						organizationId: 'org-s',
						templateId: tpl.id,
						designId: null,
						name: label,
						...(withPrinter ? { printer } : {})
					},
					'u-s'
				);
				const before = loadBuildView(db, id, 'u-s')!;
				const beforeT = timeStats(before);
				const up = createUpload(
					db,
					id,
					'u-s',
					{ name: 'sliced.gcode.3mf', size: statSync(file!).size },
					summary,
					before
				);
				const objs = summary.plates.flatMap((p) => p.objects.map((o) => ({ p: p.index, o })));
				const mapped = objs.filter(({ p, o }) => up.suggestions.mapping[`${p}:${o.id}`]);
				const unmatched = objs.filter(({ p, o }) => !up.suggestions.mapping[`${p}:${o.id}`]);
				console.log(
					`${label}: before plates ${before.plates.length} source ${before.plates[0]?.source} estimated=${beforeT.estimated}; objects ${objs.length}, matched ${mapped.length}; unmatched: ${unmatched.map(({ p, o }) => `${p}:${o.name} [${JSON.stringify(up.suggestions.matches[`${p}:${o.id}`])}]`).join(' | ')}`
				);
				console.log(
					`${label}: filamentMap ${JSON.stringify(up.suggestions.filamentMap)} roles ${before.filaments.map((f) => f.key).join(',')}`
				);
				const r = applyUpload(db, id, 'u-s', up.uploadId, {
					mapping: up.suggestions.mapping,
					filamentMap: up.suggestions.filamentMap,
					variantChoices: {},
					convertRuns: true
				});
				const after = loadBuildView(db, id, 'u-s')!;
				const t = timeStats(after);
				console.log(
					`${label}: applied ${JSON.stringify(r)}; plates ${after.plates.length}; total ${(t.totalSec / 3600).toFixed(1)} h estimated=${t.estimated}; ` +
						after.plates
							.map(
								(p) =>
									`${p.number}:${p.estSeconds}s/${p.estSource}/${p.slicerGrams}g/${JSON.stringify(p.filamentGrams)}`
							)
							.join(' ')
				);
				expect(after.plates.length).toBeGreaterThan(0);
				expect(after.plates.every((p) => p.estSource === 'slicer' && (p.estSeconds ?? 0) > 0)).toBe(
					true
				);
				expect(after.plates.every((p) => (p.slicerGrams ?? 0) > 0)).toBe(true);
				expect(after.plates.some((p) => Object.keys(p.filamentGrams).length > 0)).toBe(true);
				expect(t.estimated).toBe(false);
			}
		}
	);
});
