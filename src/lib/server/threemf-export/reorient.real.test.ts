import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { printerFromCatalog } from '#lib/printers/printer.ts';

const dbFile = process.env.TMT_REAL_DB;
// Real-mesh guard: needs TMT_REAL_DB (scratch DB with the H profile imported); never runs in CI.
describe.skipIf(!dbFile || !existsSync(dbFile))('re-orientation on the real H profile', () => {
	it('reorients', { timeout: 900_000 }, async () => {
		process.env.DATABASE_URL = resolve(dbFile!);
		const { openDb, runMigrations } = await import('../db');
		const schema = await import('../db/schema');
		const { createBuild } = await import('../builds/create');
		const { arrangeForPrinter, buildArrangement } = await import('../builds/plates');
		const { exportBuild3mf } = await import('./index');
		const { parseThreeMfBytes } = await import('../threemf/index');
		const { loadFootprints } = await import('../builds/arrange-plan');
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
		console.log('PRINTER', JSON.stringify(printer));
		const t0 = Date.now();
		const fps = loadFootprints(db, tpl.id);
		console.log('LOADFP ms', Date.now() - t0);
		const id = createBuild(
			db,
			{
				organizationId: org.id,
				templateId: tpl.id,
				designId: null,
				name: 'Reoriented check',
				printer
			},
			uid
		);
		const arr = arrangeForPrinter(db, id, uid, { convertRuns: true });
		const info = buildArrangement(db, id, uid);
		const rows: string[] = [];
		for (const pl of info.plates)
			for (const it of pl.items)
				if (it.pose) {
					const pc = fps.get(it.slug)!.pieces[it.piece];
					rows.push(
						`plate ${pl.number} ${it.slug}#${it.piece}: profile ${pc.w}x${pc.d}x${pc.h} -> pose ${it.pose.desc}; kind ${it.pose.kind} h ${it.pose.h} box ${it.w}x${it.d} rot ${it.rotation} contact ${it.pose.contactArea} support ${it.pose.supportScore}`
					);
				}
		console.log('ROWS\n' + rows.join('\n'));
		console.log(
			'PLATES',
			info.plates.length,
			'oversize',
			info.plates.filter((p) => p.oversize).map((p) => p.number + ':' + p.name)
		);
		console.log(
			'WARN\n' +
				(info.fresh?.warnings ?? []).map((w) => `${w.code} ${w.slug}: ${w.message}`).join('\n')
		);
		for (const [slug, fp] of fps)
			for (const pc of fp.pieces)
				if (pc.orient)
					console.log(
						'POSES',
						slug,
						pc.name,
						pc.w,
						pc.d,
						pc.h,
						'n',
						pc.orient.poses.length,
						'profile',
						JSON.stringify(pc.orient.profile),
						'bytes',
						JSON.stringify(pc.orient).length
					);
		const out = resolve('data/export-check');
		mkdirSync(out, { recursive: true });
		const res = exportBuild3mf(db, id, uid, { flavor: 'orca' });
		const file = join(out, res.filename.replace(/-orca\.3mf$/, '-reoriented-orca.3mf'));
		await pipeline(Readable.fromWeb(res.stream as never), createWriteStream(file));
		const s = await parseThreeMfBytes(new Uint8Array(readFileSync(file)));
		const { prepareExport } = await import('./index');
		const { unzipSync, strFromU8 } = await import('fflate');
		const prep = prepareExport(db, id, uid, { flavor: 'orca' });
		const guardMsgs = prep.plan.warnings
			.filter((w) => w.code === 'bed' || w.code === 'height')
			.map((w) => w.message);
		console.log('GUARD', guardMsgs.length, guardMsgs.join('\n'));
		let expSup = 0,
			expSeam = 0;
		const paintedParts: string[] = [];
		for (const o of prep.plan.objects) {
			const pc = fps.get(o.slug)!.pieces[o.piece];
			if (pc.paint) {
				expSup += pc.paint.supports;
				expSeam += pc.paint.seam;
				paintedParts.push(
					o.slug +
						' / ' +
						o.name +
						' supports=' +
						pc.paint.supports +
						' seam=' +
						pc.paint.seam +
						' settings=' +
						JSON.stringify(
							Object.fromEntries(
								Object.entries(pc.settings ?? {}).filter(([k]) => /support|brim|raft/.test(k))
							)
						) +
						' part=' +
						JSON.stringify(pc.partSettings ?? {})
				);
			}
		}
		const zz = unzipSync(new Uint8Array(readFileSync(file)));
		const model = strFromU8(zz['3D/3dmodel.model']);
		expect(guardMsgs).toEqual([]);
		expect((model.match(/paint_supports=/g) ?? []).length).toBe(expSup);
		expect((model.match(/paint_seam=/g) ?? []).length).toBe(expSeam);
		expect(info.plates.filter((p) => p.oversize)).toEqual([]);
		console.log(
			'PAINT expected',
			expSup,
			expSeam,
			'in file',
			(model.match(/paint_supports=/g) ?? []).length,
			(model.match(/paint_seam=/g) ?? []).length,
			'\n' + paintedParts.join('\n')
		);
		console.log(
			'EXPORT',
			file,
			'plates',
			s.plates.length,
			'warnings',
			res.warnings.map((w) => w.severity + ' ' + w.message).join(' | ')
		);
		void arr;
	});
});
