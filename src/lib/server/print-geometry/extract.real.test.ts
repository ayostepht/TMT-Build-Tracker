// Runs only when MAKEGOOD_H_3MF points at MakeGood's H-series profile 3MF (never in git, never in CI).
import { createReadStream, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { simplifyHull } from '#lib/domain/geom2d.ts';
import { tmtTemplate } from '../seed/tmt';
import { extractPartGeometry } from './extract';

const file = process.env.MAKEGOOD_H_3MF;

describe.skipIf(!file || !existsSync(file))('extractPartGeometry (real H profile)', () => {
	it('reads footprints for the TMT parts', { timeout: 300_000 }, async () => {
		const t0 = Date.now();
		const res = await extractPartGeometry(
			() => createReadStream(file!, { highWaterMark: 1 << 20 }),
			tmtTemplate.parts.map((p) => ({
				slug: p.slug,
				name: p.name,
				sourceFile: p.sourceFile,
				notes: p.notes,
				allowedMaterials: p.allowedMaterials,
				components: p.components,
				qty: p.qty
			}))
		);
		const rows = res.parts.map((p) => ({
			slug: p.slug,
			plate: p.plate,
			upp: p.unitsPerPlate,
			pieces: p.pieces.map((x) => ({
				n: x.name,
				c: x.copies,
				w: x.geometry.w,
				d: x.geometry.d,
				h: x.geometry.h,
				pw: x.geometry.placedW,
				pd: x.geometry.placedD,
				tris: x.geometry.tris
			}))
		}));
		console.log('TIME_MS', Date.now() - t0, 'RSS_MB', Math.round(process.memoryUsage().rss / 1e6));
		console.log(JSON.stringify(res.report));
		for (const p of res.parts)
			if (p.pieces.length === 1)
				console.log(
					'HULL ' +
						p.slug +
						' ' +
						JSON.stringify(
							simplifyHull(p.pieces[0].geometry.hull, 20).map(([x, y]) => [
								Math.round(x * 10) / 10,
								Math.round(y * 10) / 10
							])
						)
				);
		for (const r of rows)
			console.log(
				`${r.slug} plate${r.plate} upp${r.upp} ` +
					r.pieces
						.map(
							(x) =>
								`[${x.n.slice(0, 80)} x${x.c} ${x.w}x${x.d}x${x.h} placed ${x.pw}x${x.pd} ${x.tris}t]`
						)
						.join(' ')
			);
		expect(res.parts.length).toBeGreaterThan(15);
	});
});

// MAKEGOOD_HARNESS_ZIP: HARNESS+AND+STRAP+FILES.zip (3MFs inside a zip)
const zip = process.env.MAKEGOOD_HARNESS_ZIP;
describe.skipIf(!zip || !existsSync(zip))('importPrintGeometry (real harness zip)', () => {
	it('imports the harness and strap 3MFs', { timeout: 300_000 }, async () => {
		const { mkdtempSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');
		process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-real-')), 'u.db');
		const { openDb, runMigrations } = await import('../db');
		const { templates } = await import('../db/schema');
		const { templateSeeds } = await import('../seed');
		const { seedTemplates } = await import('../seed/run');
		const { importPrintGeometry } = await import('./import');
		const db = openDb(':memory:');
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		const id = db.select({ id: templates.id }).from(templates).get()!.id;
		const res = await importPrintGeometry(db, id, zip!, 'HARNESS.zip');
		console.log('ZIP', JSON.stringify(res.report.map((r) => [r.file, r.parts, r.unmatched])));
		const { listPrintGeometry } = await import('./import');
		console.log(
			'ZIPROWS',
			JSON.stringify(listPrintGeometry(db, id).filter((r) => r.source !== 'seed'))
		);
		expect(res.report.length).toBeGreaterThan(3);
	});
});
