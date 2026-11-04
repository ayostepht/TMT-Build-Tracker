import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import { templateHardwarePath, templateModelPath } from '../config';
import { openDb, runMigrations, type Db } from '../db';
import {
	templateModels,
	templatePartPlacements,
	templatePrintGeometry,
	templates,
	user
} from '../db/schema';
import { decodeMesh, encodeMesh, type PrintMesh } from '../print-geometry/mesh-format';
import { printDir } from '../print-geometry/store';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { buildKitPack, checkRoundTrip, cleanSettings } from './build';
import { INDEX_FORMAT, sha256Hex } from './format';
import { installKitPacks, kitInstallState } from './install';

const SLUG = templateSeeds[0].slug;
const PARTS = ['push-grip', 'tires', 'seat-center'];
const MOVED = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1];

let counter = 0;
/** A fresh install: own data dir (DATABASE_URL is read at call time), migrated and seeded. */
function freshInstall(): { db: Db; tid: string; dir: string } {
	const dir = mkdtempSync(join(tmpdir(), `tmt-kp-${process.pid}-${counter++}-`));
	process.env.DATABASE_URL = join(dir, 'tmt.db');
	const db = openDb(process.env.DATABASE_URL);
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	const tid = db.select().from(templates).where(eq(templates.slug, SLUG)).get()!.id;
	return { db, tid, dir };
}

function mesh(seed: number): PrintMesh {
	const s = 10 + seed;
	const positions = new Float32Array([
		0,
		0,
		0,
		s,
		0,
		0,
		s,
		s,
		0,
		0,
		s,
		0,
		0,
		0,
		s * 0.5,
		s,
		0,
		s * 0.5,
		s,
		s,
		s * 0.5,
		0,
		s,
		s * 0.5
	]);
	const indices = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4]);
	return {
		positions,
		indices,
		paint: [
			{ kind: 'supports', tri: 1, value: '4' },
			{ kind: 'supports', tri: 4, value: '8C8C' },
			{ kind: 'seam', tri: 5, value: '0A' }
		]
	};
}

/** A source install holding a kit imported "by an admin", from which packs are built. */
function sourceKit(note = 'profile.3mf') {
	const src = freshInstall();
	const { db, tid } = src;
	mkdirSync(join(src.dir, 'uploads', 'models'), { recursive: true });
	writeFileSync(templateModelPath(tid), Buffer.from('glTF-model-' + note));
	writeFileSync(templateHardwarePath(tid), Buffer.from('glTF-hardware'));
	db.insert(templateModels)
		.values({
			templateId: tid,
			glbPath: templateModelPath(tid),
			version: 'x',
			size: 1,
			slugs: PARTS,
			sourceNote: 'steps.zip: 3 parts'
		})
		.run();
	PARTS.forEach((slug, i) => {
		const m = mesh(i);
		const file = `${slug}.bin`;
		mkdirSync(printDir(tid), { recursive: true });
		writeFileSync(join(printDir(tid), file), encodeMesh(m));
		const fp: PrintFootprint = {
			slug,
			pieces: [
				{
					name: slug,
					w: 10,
					d: 10,
					h: 5,
					copies: 1,
					mesh: file,
					tris: 6,
					hull: [[0, 0]],
					settings: {
						wall_loops: '4',
						filament_colour: '#ff0000',
						nozzle_temperature: '250',
						sparse_infill_density: '15%'
					},
					paint: { supports: 2, seam: 1 },
					orient: { v: 2, profile: { contactArea: 1, supportScore: 0 }, poses: [{} as never] },
					sil: { v: 1, profile: { rings: [] } as never, poses: [{} as never] }
				}
			]
		};
		db.update(templatePrintGeometry)
			.set({
				footprint: fp as never,
				hull: [[0, 0]],
				height: 5,
				tris: 6,
				settings: { wall_loops: '4' },
				meshPath: `print/${tid}/${file}`,
				sourceNote: note
			})
			.where(and(eq(templatePrintGeometry.templateId, tid), eq(templatePrintGeometry.slug, slug)))
			.run();
	});
	db.update(templatePartPlacements)
		.set({ matrix: MOVED, placed: true })
		.where(
			and(eq(templatePartPlacements.templateId, tid), eq(templatePartPlacements.slug, 'push-grip'))
		)
		.run();
	return src;
}

function makePack(version: string, outDir: string) {
	const src = sourceKit();
	mkdirSync(outDir, { recursive: true });
	const outFile = join(outDir, `${SLUG}-${version}.kitpack`);
	const res = buildKitPack(src.db, { templateSlug: SLUG, version, outFile, log: () => {} });
	const bytes = readFileSync(outFile);
	return {
		outFile,
		res,
		entry: {
			slug: SLUG,
			version,
			file: `${SLUG}-${version}.kitpack`,
			sha256: sha256Hex(bytes),
			size: bytes.length
		}
	};
}

function writeIndex(dir: string, entries: object[]) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.json'), JSON.stringify({ format: INDEX_FORMAT, packs: entries }));
}

const quiet = () => {};
const geomOf = (db: Db, tid: string) =>
	db.select().from(templatePrintGeometry).where(eq(templatePrintGeometry.templateId, tid)).all();
const rowOf = (db: Db, tid: string, slug: string) => geomOf(db, tid).find((r) => r.slug === slug)!;

describe('build', () => {
	it('keeps only per-object print settings', () => {
		const c = cleanSettings({
			wall_loops: '4',
			sparse_infill_density: '15%',
			enable_support: '1',
			brim_type: 'auto_brim',
			filament_colour: '#fff',
			nozzle_temperature: '250',
			printer_settings_id: 'x',
			outer_wall_speed: '60'
		});
		expect(Object.keys(c.kept).sort()).toEqual([
			'brim_type',
			'enable_support',
			'sparse_infill_density',
			'wall_loops'
		]);
		expect(c.dropped).toContain('filament_colour');
	});
	it('detects a changed mesh in the round trip check', () => {
		const a = mesh(1);
		const b = mesh(1);
		b.paint![0].value = '5';
		expect(() => checkRoundTrip(a, b, 'x')).toThrow(/paint/);
	});
});

describe('kit pack install', () => {
	let packs: string;
	let pack: ReturnType<typeof makePack>;
	beforeEach(() => {
		packs = mkdtempSync(join(tmpdir(), 'tmt-kp-packs-'));
		pack = makePack('1.0.0', packs);
		writeIndex(packs, [pack.entry]);
	});

	it('strips poses and machine settings, keeps paint counts', () => {
		expect(pack.res.manifest.contents).toMatchObject({
			parts: 3,
			meshes: 3,
			paintedFaces: 6,
			hardware: true
		});
		expect(pack.res.manifest.license.holder).toBe('MakeGood');
		expect(pack.res.manifest.license.name).toContain('CC0');
		expect(pack.res.maxQuantError).toBeLessThanOrEqual(0.01);
	});

	it('installs model, hardware, placements and print geometry into a fresh install', async () => {
		const { db, tid } = freshInstall();
		const out = await installKitPacks(db, { dir: packs, download: false, log: quiet });
		expect(out).toEqual([
			expect.objectContaining({
				slug: SLUG,
				status: 'installed',
				model: true,
				hardware: true,
				geometry: 3
			})
		]);
		const model = db.select().from(templateModels).where(eq(templateModels.templateId, tid)).get()!;
		expect(model.sourceNote.startsWith('kitpack:1.0.0')).toBe(true);
		expect(model.slugs).toEqual(PARTS);
		expect(readFileSync(templateModelPath(tid)).toString()).toBe('glTF-model-profile.3mf');
		expect(existsSync(templateHardwarePath(tid))).toBe(true);
		for (const slug of PARTS) {
			const r = rowOf(db, tid, slug);
			expect(r.sourceNote).toBe('kitpack:1.0.0');
			const fp = r.footprint as unknown as PrintFootprint;
			expect(fp.pieces[0].settings).toEqual({ wall_loops: '4', sparse_infill_density: '15%' });
			expect(fp.pieces[0].orient?.poses).toEqual([]);
			expect(fp.pieces[0].sil?.poses).toEqual([]);
			const m = decodeMesh(readFileSync(join(printDir(tid), `${slug}.bin`)));
			expect(m.paint).toEqual(mesh(PARTS.indexOf(slug)).paint);
			expect(checkRoundTrip(mesh(PARTS.indexOf(slug)), m, slug)).toBeLessThanOrEqual(0.0051);
		}
		const pl = db
			.select()
			.from(templatePartPlacements)
			.where(
				and(
					eq(templatePartPlacements.templateId, tid),
					eq(templatePartPlacements.slug, 'push-grip')
				)
			)
			.get()!;
		expect(pl.matrix).toEqual(MOVED);
		expect(pl.placed).toBe(true);
		expect(kitInstallState(SLUG).installing).toBe(false);
	});

	it('reports installing while it runs', async () => {
		const { db } = freshInstall();
		const p = installKitPacks(db, { dir: packs, download: false, log: quiet });
		expect(kitInstallState(SLUG)).toEqual({
			installing: true,
			message: 'Installing MakeGood files…'
		});
		await p;
		expect(kitInstallState(SLUG).installing).toBe(false);
	});

	it('is idempotent', async () => {
		const { db, tid } = freshInstall();
		await installKitPacks(db, { dir: packs, download: false, log: quiet });
		const before = JSON.stringify(geomOf(db, tid));
		const second = await installKitPacks(db, { dir: packs, download: false, log: quiet });
		expect(second).toEqual([{ slug: SLUG, status: 'current', version: '1.0.0' }]);
		// even without the marker a full pass changes nothing
		const marker = join(process.env.DATABASE_URL!, '..', 'uploads', 'kitpack', `${SLUG}.json`);
		expect(existsSync(marker)).toBe(true);
		writeFileSync(marker, '{}');
		const third = await installKitPacks(db, { dir: packs, download: false, log: quiet });
		expect(third[0]).toMatchObject({
			status: 'installed',
			model: false,
			geometry: 0,
			placements: 0
		});
		expect(JSON.stringify(geomOf(db, tid))).toBe(before);
	});

	it('never overwrites admin imports or placement edits', async () => {
		const { db, tid } = freshInstall();
		db.insert(user).values({ id: 'adm', name: 'Adm', email: 'adm@example.test' }).run();
		// admin imported one part, the model, and edited a placement
		db.update(templatePrintGeometry)
			.set({ sourceNote: 'mine.3mf', height: 99 })
			.where(
				and(eq(templatePrintGeometry.templateId, tid), eq(templatePrintGeometry.slug, 'tires'))
			)
			.run();
		db.insert(templateModels)
			.values({
				templateId: tid,
				glbPath: templateModelPath(tid),
				version: 'mine',
				size: 1,
				slugs: ['tires'],
				sourceNote: 'upload.zip: 1 parts'
			})
			.run();
		mkdirSync(join(process.env.DATABASE_URL!, '..', 'uploads', 'models'), { recursive: true });
		writeFileSync(templateModelPath(tid), 'admin glb');
		db.update(templatePartPlacements)
			.set({ matrix: MOVED.map((v) => v + 1), updatedBy: 'adm' })
			.where(
				and(
					eq(templatePartPlacements.templateId, tid),
					eq(templatePartPlacements.slug, 'push-grip')
				)
			)
			.run();
		const out = await installKitPacks(db, { dir: packs, download: false, log: quiet });
		expect(out[0]).toMatchObject({ status: 'installed', model: false, geometry: 2 });
		expect(rowOf(db, tid, 'tires')).toMatchObject({ sourceNote: 'mine.3mf', height: 99 });
		expect(rowOf(db, tid, 'push-grip').sourceNote).toBe('kitpack:1.0.0');
		expect(readFileSync(templateModelPath(tid)).toString()).toBe('admin glb');
		expect(db.select().from(templateModels).get()!.version).toBe('mine');
		const pl = db
			.select()
			.from(templatePartPlacements)
			.where(
				and(
					eq(templatePartPlacements.templateId, tid),
					eq(templatePartPlacements.slug, 'push-grip')
				)
			)
			.get()!;
		expect(pl.matrix).toEqual(MOVED.map((v) => v + 1));
	});

	it('upgrades older pack data to a newer pack', async () => {
		const { db, tid } = freshInstall();
		await installKitPacks(db, { dir: packs, download: false, log: quiet });
		const v2 = makePack('1.1.0', packs);
		writeIndex(packs, [pack.entry, v2.entry]);
		const out = await installKitPacks(db, { dir: packs, download: false, log: quiet });
		expect(out[0]).toMatchObject({
			status: 'installed',
			version: '1.1.0',
			model: true,
			geometry: 3
		});
		expect(rowOf(db, tid, 'tires').sourceNote).toBe('kitpack:1.1.0');
		expect(db.select().from(templateModels).get()!.sourceNote.startsWith('kitpack:1.1.0')).toBe(
			true
		);
	});

	it('upgrades 1.0.0 pack data to 1.0.1 with source groups and leaves admin rows alone', async () => {
		const { db, tid } = freshInstall();
		await installKitPacks(db, { dir: packs, download: false, log: quiet });
		expect(rowOf(db, tid, 'tires').sourceNote).toBe('kitpack:1.0.0');
		expect(
			(rowOf(db, tid, 'push-grip').footprint as unknown as PrintFootprint).groups
		).toBeUndefined();
		// an admin re-imported one part since
		db.update(templatePrintGeometry)
			.set({ sourceNote: 'mine.3mf', height: 99 })
			.where(
				and(eq(templatePrintGeometry.templateId, tid), eq(templatePrintGeometry.slug, 'tires'))
			)
			.run();
		// pack 1.0.1: the same kit, push-grip with a source group
		const src = sourceKit();
		const row = rowOf(src.db, src.tid, 'push-grip');
		const fp = structuredClone(row.footprint) as unknown as PrintFootprint;
		fp.pieces[0].copies = 2;
		fp.groups = [
			{
				v: 1,
				plate: 4,
				bed: { x: 256, y: 256 },
				items: [
					{ piece: 0, x: -20, y: 0, rot: 0 },
					{ piece: 0, x: 20, y: 0, rot: 90 }
				],
				w: 50,
				d: 10,
				outline: [
					[
						[-25, -5],
						[25, -5],
						[25, 5],
						[-25, 5]
					]
				],
				hull: [
					[-25, -5],
					[25, -5],
					[25, 5],
					[-25, 5]
				]
			}
		];
		src.db
			.update(templatePrintGeometry)
			.set({ footprint: fp as never })
			.where(
				and(
					eq(templatePrintGeometry.templateId, src.tid),
					eq(templatePrintGeometry.slug, 'push-grip')
				)
			)
			.run();
		const outFile = join(packs, `${SLUG}-1.0.1.kitpack`);
		buildKitPack(src.db, { templateSlug: SLUG, version: '1.0.1', outFile, log: quiet });
		const bytes = readFileSync(outFile);
		writeIndex(packs, [
			pack.entry,
			{
				slug: SLUG,
				version: '1.0.1',
				file: `${SLUG}-1.0.1.kitpack`,
				sha256: sha256Hex(bytes),
				size: bytes.length
			}
		]);
		const out = await installKitPacks(db, { dir: packs, download: false, log: quiet });
		expect(out[0]).toMatchObject({
			status: 'installed',
			version: '1.0.1',
			geometry: 2,
			keptAdmin: 1
		});
		expect(rowOf(db, tid, 'tires')).toMatchObject({ sourceNote: 'mine.3mf', height: 99 });
		const up = rowOf(db, tid, 'push-grip');
		expect(up.sourceNote).toBe('kitpack:1.0.1');
		const groups = (up.footprint as unknown as PrintFootprint).groups!;
		expect(groups).toHaveLength(1);
		expect(groups[0].items).toHaveLength(2);
	});

	it('refuses a pack whose sha256 does not match the index', async () => {
		const { db, tid } = freshInstall();
		writeIndex(packs, [{ ...pack.entry, sha256: 'b'.repeat(64) }]);
		const out = await installKitPacks(db, { dir: packs, download: false, log: quiet });
		expect(out[0]).toMatchObject({ slug: SLUG, status: 'failed' });
		expect((out[0] as { reason: string }).reason).toMatch(/sha256 mismatch/);
		expect(
			db.select().from(templateModels).where(eq(templateModels.templateId, tid)).get()
		).toBeUndefined();
		expect(rowOf(db, tid, 'tires').sourceNote).toBe('seed');
	});

	it('refuses a modified pack file', async () => {
		const { db } = freshInstall();
		const bytes = readFileSync(pack.outFile);
		bytes[bytes.length - 40] ^= 0xff;
		writeFileSync(pack.outFile, bytes);
		const out = await installKitPacks(db, { dir: packs, download: false, log: quiet });
		expect(out[0].status).toBe('failed');
	});

	it('does nothing when the pack is absent and downloads are off', async () => {
		const { db, tid } = freshInstall();
		const empty = mkdtempSync(join(tmpdir(), 'tmt-kp-empty-'));
		writeIndex(empty, [pack.entry]);
		const out = await installKitPacks(db, { dir: empty, download: false, log: quiet });
		expect(out[0]).toMatchObject({ slug: SLUG, status: 'unavailable' });
		expect(
			db.select().from(templateModels).where(eq(templateModels.templateId, tid)).get()
		).toBeUndefined();
		expect(kitInstallState(SLUG).installing).toBe(false);
		// no index at all: also fine
		expect(
			await installKitPacks(db, { dir: join(empty, 'nope'), download: false, log: quiet })
		).toEqual([{ slug: SLUG, status: 'none' }]);
	});

	it('downloads a missing pack (file:// URL) and verifies it', async () => {
		const { db, tid } = freshInstall();
		const empty = mkdtempSync(join(tmpdir(), 'tmt-kp-dl-'));
		writeIndex(empty, [pack.entry]);
		const out = await installKitPacks(db, {
			dir: empty,
			download: true,
			url: `file://${packs}/{file}`,
			log: quiet
		});
		expect(out[0]).toMatchObject({ status: 'installed', model: true });
		expect(
			db.select().from(templateModels).where(eq(templateModels.templateId, tid)).get()
		).toBeDefined();
		// a wrong hash from the download is refused
		const bad = freshInstall();
		writeIndex(empty, [{ ...pack.entry, sha256: 'c'.repeat(64) }]);
		const out2 = await installKitPacks(bad.db, {
			dir: empty,
			download: true,
			url: `file://${packs}/{file}`,
			log: quiet
		});
		expect(out2[0].status).toBe('failed');
	});
});
