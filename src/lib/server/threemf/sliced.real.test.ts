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

	it.skipIf(!process.env.KITPACK_DIR)(
		'print template: learn per-part data, arrange for the Centauri Carbon, recolor and re-arrange',
		{ timeout: 900_000 },
		async () => {
			const work = resolve('data/scratch/print-template-real-' + Date.now());
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
			const { updateBuildDesign } = await import('../designs/mutate');
			const { timeStats } = await import('#lib/domain/accounting.ts');
			const { catalogPrinter } = await import('#lib/printers/catalog.ts');
			const { printerFromCatalog } = await import('#lib/printers/printer.ts');
			const { attachGcodeObjectStats } = await import('./gcode-stats');
			const db = openDb(process.env.DATABASE_URL);
			runMigrations(db);
			seedTemplates(db, templateSeeds);
			await installKitPacks(db, { dir: process.env.KITPACK_DIR!, download: false });
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
			const fileHours =
				summary.plates.reduce((a, p) => a + (p.estSeconds ?? 0) * Math.max(1, p.runsHint), 0) /
				3600;
			const t0 = performance.now();
			const rep = await attachGcodeObjectStats(file!, summary);
			console.log(
				`PT scan ${JSON.stringify(rep)} in ${Math.round(performance.now() - t0)} ms; file total ${fileHours.toFixed(1)} h`
			);

			for (const method of ['exact', 'volume-split'] as const) {
				const sum =
					method === 'exact'
						? summary
						: { ...summary, plates: summary.plates.map((p) => ({ ...p, exact: undefined })) };
				const id = createBuild(
					db,
					{ organizationId: 'org-s', templateId: tpl.id, designId: null, name: method, printer },
					'u-s'
				);
				const before = loadBuildView(db, id, 'u-s')!;
				const up = createUpload(
					db,
					id,
					'u-s',
					{ name: 'sliced.gcode.3mf', size: statSync(file!).size },
					sum,
					before
				);
				const t1 = performance.now();
				const r = applyUpload(db, id, 'u-s', up.uploadId, {
					mapping: up.suggestions.mapping,
					filamentMap: up.suggestions.filamentMap,
					mode: 'template',
					arrange: true,
					convertRuns: true
				});
				const v = loadBuildView(db, id, 'u-s')!;
				const t = timeStats(v);
				console.log(
					`PT[${method}] applied ${JSON.stringify(r)} in ${Math.round(performance.now() - t1)} ms; template ${JSON.stringify(v.printTemplate)}; arranged plates ${v.plates.length}, total ${(t.totalSec / 3600).toFixed(1)} h (file ${fileHours.toFixed(1)} h), learned=${t.learned} estimated=${t.estimated}`
				);
				const order = [
					'wing-left',
					'wing-right',
					'handle-left',
					'handle-right',
					'seat-center',
					'wheel-mount-left',
					'storage-left',
					'tires',
					'footrest',
					'rims-small-1-4'
				];
				const rows = Object.entries(v.partProfiles!)
					.sort((a, b) => ((order.indexOf(a[0]) + 100) % 100) - ((order.indexOf(b[0]) + 100) % 100))
					.slice(0, 12)
					.map(([slug, pr]) => {
						const part = v.allParts.find((x) => x.slug === slug)!;
						return `  ${slug.padEnd(22)} qty ${String(part.qty).padEnd(3)} role ${part.role.padEnd(8)} ${((pr.secondsPerCopy ?? 0) / 3600).toFixed(2).padStart(7)} h/copy  ${JSON.stringify(pr.gramsByRole)}  ${pr.method}`;
					});
				console.log(
					`PT[${method}] parts (${Object.keys(v.partProfiles!).length} learned)\n` + rows.join('\n')
				);
				if (method === 'exact') {
					const active = new Set(v.parts.map((x) => x.slug));
					const missing = v.parts.filter((x) => !v.partProfiles![x.slug]);
					const inactive = Object.keys(v.partProfiles!).filter((x) => !active.has(x));
					console.log(
						`PT coverage: active parts ${v.parts.length}, without learned data: ${missing.map((x) => x.slug).join(', ') || 'none'}; learned but inactive (other variant option): ${inactive.join(', ') || 'none'}`
					);
					const rowsDb = db
						.select()
						.from(schema.buildPartProfiles)
						.all()
						.filter((r) => r.buildId === id);
					let sumCopies = 0;
					let sumQty = 0;
					const diffs: string[] = [];
					for (const r of rowsDb) {
						const copies = Number((r.context as { copies?: number }).copies ?? 1);
						const part = v.allParts.find((x) => x.slug === r.partSlug)!;
						const q = Math.max(1, part.qty ?? 1);
						sumCopies += ((r.secondsPerCopy ?? 0) * copies) / 3600;
						sumQty += ((r.secondsPerCopy ?? 0) * q) / 3600;
						if (copies !== q)
							diffs.push(
								`${r.partSlug}(copies ${copies}, qty ${part.qty}, ${((r.secondsPerCopy ?? 0) / 3600).toFixed(1)} h)`
							);
					}
					console.log(
						`PT sums: by copies in file ${sumCopies.toFixed(1)} h, by kit qty ${sumQty.toFixed(1)} h; copies != qty: ${diffs.join(', ')}`
					);
					const wing0 = v.plates.find((p) => p.parts.includes('wing-left'))!;
					const role0 = v.parts.find((p) => p.slug === 'wing-left')!.role;
					const other = role0 === 'primary' ? 'accent' : 'primary';
					const t2 = performance.now();
					updateBuildDesign(db, id, 'u-s', { partRoles: { 'wing-left': other } });
					const w = loadBuildView(db, id, 'u-s')!;
					const tt = timeStats(w);
					const wing1 = w.plates.find((p) => p.parts.includes('wing-left'))!;
					console.log(
						`PT recolor wing-left ${role0} -> ${other} (auto re-arrange ${Math.round(performance.now() - t2)} ms): plates ${w.plates.length}, total ${(tt.totalSec / 3600).toFixed(1)} h learned=${tt.learned}; wing plate before ${wing0.number} ${wing0.estSeconds}s ${wing0.estSource}, after ${wing1.number} ${wing1.estSeconds}s ${wing1.estSource} ${JSON.stringify(wing1.filamentGrams)}; profile ${JSON.stringify(w.partProfiles!['wing-left'])}`
					);
					expect(wing1.estSource).toBe('learned');
					expect(w.partProfiles!['wing-left'].remapped).toBe(true);
				}
				expect(t.learned).toBe(true);
			}
		}
	);
});
