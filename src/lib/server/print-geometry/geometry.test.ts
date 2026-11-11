import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { eq } from 'drizzle-orm';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import { loadFootprints } from '../builds/arrange-plan';
import { openDb, runMigrations, type Db } from '../db';
import { templatePrintGeometry, templates } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { makeProjectThreeMf } from '../threemf/fixtures';
import { extractPartGeometry } from './extract';
import { importPrintGeometry, listPrintGeometry } from './import';
import { decodeMesh, encodeMesh } from './mesh-format';
import { printDir, readPieceMesh } from './store';
import { ModelScanner, normalizeMesh } from './reader';
import { zipSync } from 'fflate';

process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-geo-')), 'unused.db');

/** A box mesh as a 3MF object file. */
function boxModel(id: number, sx: number, sy: number, sz: number): string {
	const v = [
		[0, 0, 0],
		[sx, 0, 0],
		[sx, sy, 0],
		[0, sy, 0],
		[0, 0, sz],
		[sx, 0, sz],
		[sx, sy, sz],
		[0, sy, sz]
	];
	const t = [
		[0, 2, 1],
		[0, 3, 2],
		[4, 5, 6],
		[4, 6, 7],
		[0, 1, 5],
		[0, 5, 4],
		[1, 2, 6],
		[1, 6, 5],
		[2, 3, 7],
		[2, 7, 6],
		[3, 0, 4],
		[3, 4, 7]
	];
	return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources><object id="${id}" type="model"><mesh><vertices>${v
		.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`)
		.join('')}</vertices><triangles>${t
		.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
		.join('')}</triangles></mesh></object></resources><build/></model>`;
}

const rotZ90 = '0 1 0 -1 0 0 0 0 1'; // row-vector 3x3: x' = -y, y' = x
function threeMf(
	opts: { item?: string; instances?: number; name?: string; box?: [number, number, number] } = {}
) {
	const [sx, sy, sz] = opts.box ?? [100, 20, 10];
	const name = opts.name ?? '3DTMT C1 WING LEFT REV B.STEP';
	const items = Array.from(
		{ length: opts.instances ?? 1 },
		(_, i) =>
			`<item objectid="2" transform="${opts.item ?? `${rotZ90} ${500 + i * 200} 300 7`}" printable="1"/>`
	).join('');
	return makeProjectThreeMf({
		plates: [{ name: 'Wing', objects: [{ name, instances: opts.instances ?? 1 }] }],
		extra: {
			'3D/3dmodel.model': strToU8(
				`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><metadata name="Application">BambuStudio-02.06.00.51</metadata><resources><object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object></resources><build>${items}</build></model>`
			),
			'3D/Objects/object_1.model': strToU8(boxModel(1, sx, sy, sz))
		}
	});
}

const parts = [
	{
		slug: 'wing-left',
		name: 'Wing Left',
		sourceFile: '3DTMT C1 WING LEFT REV B.STEP',
		qty: 1 as number | null
	}
];
const open = (bytes: Uint8Array) => () => [bytes];

describe('mesh format', () => {
	it('round-trips', () => {
		const m = {
			positions: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8.5]),
			indices: new Uint32Array([0, 1, 2])
		};
		const out = decodeMesh(encodeMesh(m));
		expect([...out.positions]).toEqual([...m.positions]);
		expect([...out.indices]).toEqual([0, 1, 2]);
		expect(() => decodeMesh(new Uint8Array(20))).toThrow();
	});
});

describe('extractPartGeometry (synthetic 3MF)', () => {
	it('applies the build transform, drops to z = 0 and centres', async () => {
		const res = await extractPartGeometry(open(threeMf()), parts);
		expect(res.parts).toHaveLength(1);
		const g = res.parts[0].pieces[0].geometry;
		// the 100 x 20 box was turned 90 degrees in the build, the min box brings it back to w >= d
		expect(g.w).toBeCloseTo(100, 0);
		expect(g.d).toBeCloseTo(20, 0);
		expect(g.h).toBeCloseTo(10, 0);
		expect(g.placedW).toBeCloseTo(20, 0);
		expect(g.placedD).toBeCloseTo(100, 0);
		let minZ = Infinity;
		let sx = 0;
		let sy = 0;
		const n = g.positions.length / 3;
		for (let i = 0; i < n; i++) {
			minZ = Math.min(minZ, g.positions[i * 3 + 2]);
			sx += g.positions[i * 3];
			sy += g.positions[i * 3 + 1];
		}
		expect(minZ).toBeCloseTo(0);
		expect(sx / n).toBeCloseTo(0, 3);
		expect(sy / n).toBeCloseTo(0, 3);
		expect(g.tris).toBe(12);
		expect(g.hull.length).toBeGreaterThanOrEqual(4);
	});

	it('keeps the print tilt (z extent) and counts duplicates', async () => {
		// 30 degrees about x: z extent grows to sz*cos + sy*sin
		const c = Math.cos(Math.PI / 6);
		const s = Math.sin(Math.PI / 6);
		const tilt = `1 0 0 0 ${c} ${s} 0 ${-s} ${c} 0 0 0`;
		const res = await extractPartGeometry(open(threeMf({ item: tilt, instances: 3 })), parts);
		const piece = res.parts[0].pieces[0];
		expect(piece.geometry.h).toBeCloseTo(10 * c + 20 * s, 0);
		expect(piece.onPlate).toBe(3);
		expect(piece.copies).toBe(3);
		expect(res.parts[0].unitsPerPlate).toBe(1);
	});

	it('flips winding for mirrored items', async () => {
		const res = await extractPartGeometry(
			open(threeMf({ item: '-1 0 0 0 1 0 0 0 1 0 0 0' })),
			parts
		);
		const g = res.parts[0].pieces[0].geometry;
		// signed volume stays positive after the flip
		let vol = 0;
		for (let i = 0; i < g.indices.length; i += 3) {
			const [a, b, c] = [g.indices[i], g.indices[i + 1], g.indices[i + 2]].map((k) => [
				g.positions[k * 3],
				g.positions[k * 3 + 1],
				g.positions[k * 3 + 2]
			]);
			vol +=
				(a[0] * (b[1] * c[2] - b[2] * c[1]) -
					a[1] * (b[0] * c[2] - b[2] * c[0]) +
					a[2] * (b[0] * c[1] - b[1] * c[0])) /
				6;
		}
		expect(vol).toBeGreaterThan(0);
	});

	it('reports unmatched objects and carries the author settings', async () => {
		const bytes = threeMf({ name: 'Mystery Widget XYZ' });
		const res = await extractPartGeometry(open(bytes), parts);
		expect(res.parts).toHaveLength(0);
		expect(res.report.unmatched).toEqual(['Mystery Widget XYZ']);
		const ok = await extractPartGeometry(open(threeMf()), parts);
		expect(ok.parts[0].pieces[0].settings.extruder).toBe('1');
	});

	it('normalizeMesh turns a tilted bar to its min box', () => {
		// a flat 200 x 20 bar rotated 30 degrees in plan
		const a = (30 * Math.PI) / 180;
		const corners = [
			[-100, -10],
			[100, -10],
			[100, 10],
			[-100, 10]
		].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
		const pos = new Float64Array(corners.flatMap(([x, y], i) => [x, y, i < 2 ? 0 : 5]));
		const g = normalizeMesh(pos, new Uint32Array([0, 1, 2, 0, 2, 3]), '1');
		expect(g.w).toBeCloseTo(200, 0);
		expect(g.d).toBeCloseTo(20, 0);
		expect(g.placedW).toBeLessThan(g.w);
	});
});

describe('importPrintGeometry', () => {
	let db: Db;
	let templateId: string;
	beforeEach(() => {
		db = openDb(':memory:');
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	});
	const file = (bytes: Uint8Array) => {
		const p = join(mkdtempSync(join(tmpdir(), 'tmt-up-')), 'up.3mf');
		writeFileSync(p, bytes);
		return p;
	};

	it('seeds footprints from the kit data', () => {
		const fps = loadFootprints(db, templateId);
		expect(fps.get('wing-left')?.pieces[0]).toMatchObject({ w: 330.9, d: 189.7 });
		expect(fps.get('rims-1-4')?.unitsPerPlate).toBe(1);
		const rows = listPrintGeometry(db, templateId);
		expect(rows.every((r) => r.source === 'seed')).toBe(true);
		expect(rows.find((r) => r.slug === 'connectors')?.pieces).toBeGreaterThan(3);
	});

	it('stores meshes and replaces the seed row', async () => {
		const res = await importPrintGeometry(db, templateId, file(threeMf()), 'profile.3mf');
		expect(res.imported).toBe(1);
		const row = db
			.select()
			.from(templatePrintGeometry)
			.where(eq(templatePrintGeometry.slug, 'wing-left'))
			.get()!;
		expect(row.sourceNote).toBe('profile.3mf');
		expect(row.meshPath).toBe(`print/${templateId}/wing-left.bin`);
		expect(existsSync(join(printDir(templateId), 'wing-left.bin'))).toBe(true);
		const fp = loadFootprints(db, templateId).get('wing-left')!;
		expect(fp.pieces[0].w).toBeCloseTo(100, 0);
		expect(fp.pieces[0].mesh).toBe('wing-left.bin');
		expect(readPieceMesh(templateId, fp.pieces[0].mesh!).indices.length).toBe(36);
		// other parts keep their seed rows
		expect(
			listPrintGeometry(db, templateId).filter((r) => r.source === 'seed').length
		).toBeGreaterThan(20);
		// re-seeding does not overwrite imported rows
		seedTemplates(db, templateSeeds);
		expect(listPrintGeometry(db, templateId).find((r) => r.slug === 'wing-left')?.source).toBe(
			'profile.3mf'
		);
	});

	it('stores the flat outline on import, computes it lazily for older rows, never poses', async () => {
		await importPrintGeometry(db, templateId, file(threeMf()), 'profile.3mf');
		const get = () =>
			db
				.select()
				.from(templatePrintGeometry)
				.where(eq(templatePrintGeometry.slug, 'wing-left'))
				.get()!;
		const fp = get().footprint as unknown as PrintFootprint;
		expect(fp.pieces[0].sil?.profile.rings.length).toBeGreaterThan(0);
		expect('orient' in fp.pieces[0]).toBe(false);
		// simulate a row imported before outlines existed
		delete fp.pieces[0].sil;
		db.update(templatePrintGeometry)
			.set({ footprint: fp as unknown as Record<string, unknown> })
			.where(eq(templatePrintGeometry.slug, 'wing-left'))
			.run();
		expect((get().footprint as unknown as PrintFootprint).pieces[0].sil).toBeUndefined();
		const got = loadFootprints(db, templateId).get('wing-left')!;
		expect(got.pieces[0].sil?.profile.rings.length).toBeGreaterThan(0);
		expect('orient' in got.pieces[0]).toBe(false);
		// cached in the row
		expect((get().footprint as unknown as PrintFootprint).pieces[0].sil?.v).toBeGreaterThan(0);
		// seed rows (no mesh) have no outline
		expect(loadFootprints(db, templateId).get('rims-1-4')?.pieces[0].sil).toBeUndefined();
	});

	it('reads 3MFs out of a zip', async () => {
		const zip = zipSync({ 'WING LEFT.3mf': threeMf() });
		const res = await importPrintGeometry(db, templateId, file(zip), 'bundle.zip');
		expect(res.report[0].file).toBe('WING LEFT.3mf');
		expect(res.imported).toBe(1);
	});

	it('rejects a zip without a 3MF', async () => {
		const zip = zipSync({ 'readme.txt': strToU8('hi') });
		await expect(importPrintGeometry(db, templateId, file(zip), 'x.zip')).rejects.toThrow(/No 3MF/);
	});
});

describe('mesh paint (supports, seam)', () => {
	it('round-trips with a version-2 file and stays backward compatible with version 1', () => {
		const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
		const indices = new Uint32Array([0, 2, 1, 0, 1, 3]);
		const plain = decodeMesh(encodeMesh({ positions, indices }));
		expect(plain.paint).toBeUndefined();
		const bytes = encodeMesh({
			positions,
			indices,
			paint: [
				{ kind: 'supports', tri: 1, value: '4C' },
				{ kind: 'seam', tri: 0, value: '8' }
			]
		});
		const back = decodeMesh(bytes);
		expect(back.paint).toEqual([
			{ kind: 'supports', tri: 1, value: '4C' },
			{ kind: 'seam', tri: 0, value: '8' }
		]);
		expect(Array.from(back.indices)).toEqual([0, 2, 1, 0, 1, 3]);
	});
});

describe('ModelScanner paint', () => {
	it('keeps paint_supports and paint_seam per triangle, in triangle order', () => {
		const sc = new ModelScanner(true);
		const xml = `<model><resources><object id="1" type="model"><mesh><vertices>
<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices><triangles>
<triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="2" v3="3" paint_supports="4C"/><triangle v1="1" v2="2" v3="3" paint_seam="8" paint_supports="0C"/>
</triangles></mesh></object></resources></model>`;
		sc.push(new TextEncoder().encode(xml), true);
		expect(sc.scan.objects.get('1')!.paint).toEqual([
			{ kind: 'supports', tri: 1, value: '4C' },
			{ kind: 'seam', tri: 2, value: '8' },
			{ kind: 'supports', tri: 2, value: '0C' }
		]);
	});
});

describe('source groups', () => {
	it('keeps the layout of a part with several objects on one plate', async () => {
		// two copies of one bar: one turned 90 degrees at (500, 300), one as is at (560, 300)
		const bytes = threeMf({ instances: 1 });
		const two = makeProjectThreeMf({
			plates: [
				{
					name: 'Wings',
					objects: [{ name: '3DTMT C1 WING LEFT REV B.STEP', instances: 2 }]
				}
			],
			extra: {
				'3D/3dmodel.model': strToU8(
					`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><metadata name="Application">BambuStudio-02.06.00.51</metadata><resources><object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object></resources><build><item objectid="2" transform="${rotZ90} 500 300 7" printable="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 560 300 7" printable="1"/></build></model>`
				),
				'3D/Objects/object_1.model': strToU8(boxModel(1, 100, 20, 10)),
				'Metadata/project_settings.config': strToU8(
					JSON.stringify({ printable_area: ['0x0', '256x0', '256x256', '0x256'] })
				)
			}
		});
		void bytes;
		const res = await extractPartGeometry(open(two), parts);
		const g = res.parts[0].groups;
		expect(g).toHaveLength(1);
		expect(g![0].bed).toEqual({ x: 256, y: 256 });
		expect(g![0].items).toHaveLength(2);

		const db = openDb(':memory:');
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		const templateId = db.select({ id: templates.id }).from(templates).get()!.id;
		const p = join(mkdtempSync(join(tmpdir(), 'tmt-grp-')), 'g.3mf');
		writeFileSync(p, two);
		await importPrintGeometry(db, templateId, p, 'g.3mf');
		const fp = loadFootprints(db, templateId).get('wing-left')!;
		expect(fp.pieces).toHaveLength(1);
		expect(fp.groups).toHaveLength(1);
		const grp = fp.groups![0];
		expect(Math.abs(grp.w - 180)).toBeLessThan(1.5);
		expect(Math.abs(grp.d - 100)).toBeLessThan(1.5);
		expect(grp.bed).toEqual({ x: 256, y: 256 });
		// world bars: x 480..500 / y 300..400 and x 560..660 / y 300..320; group origin = centre of 480..660 x 300..400
		const centres = grp.items
			.map((i) => {
				const a = (i.rot * Math.PI) / 180;
				const m = fp.pieces[i.piece];
				// the piece box centre is its mesh origin, so the item position is the box centre
				void a;
				void m;
				return [Math.round(i.x) + 0, Math.round(i.y) + 0];
			})
			.sort((x, y) => x[0] - y[0]);
		expect(centres).toEqual([
			[-80, 0],
			[40, -40]
		]);
		// two rings of the outline, 4 corners at least each
		expect(grp.outline.length).toBeGreaterThanOrEqual(2);
	});
});
