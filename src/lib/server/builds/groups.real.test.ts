// Runs only when TMT_PACK_DIR points at a directory with a kit pack and its index.json (never in CI).
// Installs the pack into a scratch database under data/, arranges the whole kit for the Elegoo
// Centauri Carbon (256 x 256 with its keep-out) and writes a report to TMT_GROUPS_OUT:
// plates, every multi-piece part's outcome, the export guard. TMT_GROUPS_DB keeps the database.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = process.env.TMT_PACK_DIR;

describe.skipIf(!dir || !existsSync(dir!))('rigid groups against the real kit pack', () => {
	it('arranges the kit on a Centauri Carbon', { timeout: 900_000 }, async () => {
		const work = resolve(process.env.TMT_GROUPS_DB ?? 'data/scratch/groups-real-' + process.pid);
		mkdirSync(work, { recursive: true });
		process.env.DATABASE_URL = resolve(work, 'tmt.db');
		const { openDb, runMigrations } = await import('../db');
		const schema = await import('../db/schema');
		const { templateSeeds } = await import('../seed');
		const { seedTemplates } = await import('../seed/run');
		const { installKitPacks } = await import('../kitpack/install');
		const { createBuild } = await import('./create');
		const { arrangeForPrinter, buildArrangement } = await import('./plates');
		const { previewExport } = await import('../threemf-export/index');
		const { catalogPrinter } = await import('#lib/printers/catalog.ts');
		const { printerFromCatalog } = await import('#lib/printers/printer.ts');
		const { loadFootprints } = await import('./arrange-plan');
		const db = openDb(process.env.DATABASE_URL);
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		const out = await installKitPacks(db, { dir: dir!, download: false });
		console.log('INSTALL', JSON.stringify(out));
		const tpl = db.select().from(schema.templates).get()!;
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
		const printer = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);
		const id = createBuild(
			db,
			{ organizationId: 'org-r', templateId: tpl.id, designId: null, name: 'Real', printer },
			'u-r'
		);
		const arr = arrangeForPrinter(db, id, 'u-r', { convertRuns: true });
		const info = buildArrangement(db, id, 'u-r');
		const fps = loadFootprints(db, tpl.id);
		const lines: string[] = [`plates: ${info.plates.length}`];
		for (const p of info.plates)
			lines.push(
				`plate ${p.number} "${p.name}" runs ${p.runs} util ${p.utilisation} items ${p.items.length} groups ${new Set(p.items.map((i) => i.group).filter((g) => g !== undefined)).size}`
			);
		lines.push('--- multi-piece parts');
		for (const [slug, fp] of fps) {
			const n = fp.pieces.reduce((a, p) => a + p.copies, 0);
			if (fp.pieces.length < 2 && n < 2) continue;
			const nums = info.plates.filter((p) => p.parts.includes(slug)).map((p) => p.number);
			const grouped = info.plates
				.filter((p) => p.parts.includes(slug))
				.flatMap((p) => p.items.filter((i) => i.slug === slug && i.group !== undefined));
			lines.push(
				`${slug}: pieces ${fp.pieces.length} objects ${n} groups ${fp.groups?.length ?? 0} -> plates ${nums.join(',') || '-'} (rigid items ${grouped.length}/${n})`
			);
		}
		// the layout of every group on the plates must equal the source's: the smallest gap between two
		// pieces' hulls (negative = the hulls overlap, which a nested source layout may do by design)
		const { polygonDistance, rotatePoints } = await import('#lib/domain/geom2d.ts');
		const place = (hull: [number, number][], rot: number, x: number, y: number) =>
			rotatePoints(hull, (rot * Math.PI) / 180).map(([a, b]) => [a + x, b + y] as [number, number]);
		const gap = (polys: [number, number][][]) => {
			let g = Infinity;
			for (let i = 0; i < polys.length; i++)
				for (let j = i + 1; j < polys.length; j++)
					g = Math.min(g, polygonDistance(polys[i], polys[j]));
			return g;
		};
		for (const pl of info.plates) {
			const byGroup = new Map<number, typeof pl.items>();
			for (const it of pl.items)
				if (it.group !== undefined) byGroup.set(it.group, [...(byGroup.get(it.group) ?? []), it]);
			for (const [gid, its] of byGroup) {
				const fp = fps.get(its[0].slug)!;
				const hull = (i: number) => fp.pieces[i].hull as [number, number][];
				const out = gap(
					its.map((it) =>
						place(hull(it.piece), it.rotation, it.x - (it.ox ?? 0), it.y - (it.oy ?? 0))
					)
				);
				const src = fp.groups!.find((g) => g.items.length === its.length)!;
				const srcGap = gap(src.items.map((it) => place(hull(it.piece), it.rot, it.x, it.y)));
				lines.push(
					`group ${its[0].slug} plate ${pl.number} #${gid}: min hull gap on the plate ${out.toFixed(2)} vs source ${srcGap.toFixed(2)}`
				);
				expect(Math.abs(Math.max(out, -1) - Math.max(srcGap, -1))).toBeLessThan(0.3);
			}
		}
		const pre = previewExport(db, id, 'u-r', { flavor: 'orca' });
		lines.push(
			'warnings: ' +
				JSON.stringify(
					arr.warnings.map((w: { code: string; slug: string }) => `${w.code}:${w.slug}`)
				)
		);
		lines.push('export warnings: ' + JSON.stringify(pre.warnings));
		console.log('REPORT\n' + lines.join('\n'));
		if (process.env.TMT_GROUPS_OUT) {
			writeFileSync(process.env.TMT_GROUPS_OUT, lines.join('\n'));
			writeFileSync(process.env.TMT_GROUPS_OUT + '.json', JSON.stringify(info));
		}
		expect(pre.warnings.filter((w) => w.severity === 'error')).toEqual([]);
	});
});
