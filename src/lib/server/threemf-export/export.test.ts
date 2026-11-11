import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { makeView } from '#lib/domain/fixtures.ts';
import type { ArrangedPlate } from '#lib/domain/arrange.ts';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import type { BuildPrinter, BuildView } from '#lib/domain/types.ts';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { printerFromCatalog } from '#lib/printers/printer.ts';
import { ApiError } from '../access';
import { planArrangement } from '../builds/arrange-plan';
import { createBuild } from '../builds/create';
import { setPrinter } from '../builds/actions';
import { loadBuildView } from '../builds/view';
import { openDb, runMigrations, type Db } from '../db';
import { buildPlates, member, organization, templates, user } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import type { ExtractedPart } from '../print-geometry/extract';
import type { PrintMesh } from '../print-geometry/mesh-format';
import { storeExtractedParts } from '../print-geometry/store';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { parseThreeMfBytes } from '../threemf/index';
import {
	buildExportPlan,
	exportBuild3mf,
	exportFilename,
	plateColumns,
	plateOrigin,
	prepareExport,
	previewExport,
	toWebStream
} from './index';
import { checkPlacement } from './check';
import { itemTransform, writePlainZip, writeThreeMf, type WriterIo } from './writer';

process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-exp-')), 'unused.db');

// ---- synthetic meshes (no MakeGood data)

/** Box centred in XY, z 0..h, outward CCW triangles. */
function cube(w: number, d: number, h: number): PrintMesh {
	const x = w / 2;
	const y = d / 2;
	const positions = new Float32Array([
		-x,
		-y,
		0,
		x,
		-y,
		0,
		x,
		y,
		0,
		-x,
		y,
		0,
		-x,
		-y,
		h,
		x,
		-y,
		h,
		x,
		y,
		h,
		-x,
		y,
		h
	]);
	const indices = new Uint32Array([
		0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
		4, 3, 4, 7
	]);
	return { positions, indices };
}
/** Triangular prism along y. */
function prism(w: number, d: number, h: number): PrintMesh {
	const x = w / 2;
	const y = d / 2;
	const positions = new Float32Array([-x, -y, 0, x, -y, 0, 0, -y, h, -x, y, 0, x, y, 0, 0, y, h]);
	const indices = new Uint32Array([
		0, 1, 2, 3, 5, 4, 0, 4, 1, 0, 3, 4, 1, 5, 2, 1, 4, 5, 2, 3, 0, 2, 5, 3
	]);
	return { positions, indices };
}
function bbox(m: PrintMesh) {
	const b = {
		x0: Infinity,
		x1: -Infinity,
		y0: Infinity,
		y1: -Infinity,
		z0: Infinity,
		z1: -Infinity
	};
	for (let i = 0; i < m.positions.length; i += 3) {
		b.x0 = Math.min(b.x0, m.positions[i]);
		b.x1 = Math.max(b.x1, m.positions[i]);
		b.y0 = Math.min(b.y0, m.positions[i + 1]);
		b.y1 = Math.max(b.y1, m.positions[i + 1]);
		b.z0 = Math.min(b.z0, m.positions[i + 2]);
		b.z1 = Math.max(b.z1, m.positions[i + 2]);
	}
	return b;
}

const cc: BuildPrinter = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);

const SHAPES: Record<string, { mesh: PrintMesh; copies: number; qty?: number }> = {
	'wing-left': { mesh: cube(200, 80, 20), copies: 1 },
	'wing-right': { mesh: cube(200, 80, 20), copies: 1 },
	footrest: { mesh: prism(200, 100, 30), copies: 1 },
	'push-pin': { mesh: cube(10, 10, 10), copies: 1 }
};
const SETTINGS: Record<string, Record<string, string>> = {
	'wing-left': {
		wall_loops: '4',
		sparse_infill_density: '20%',
		enable_support: '1',
		support_type: 'tree(auto)',
		brim_type: 'outer_only',
		brim_width: '5',
		extruder: '1'
	}
};

function footprints(shapes = SHAPES): Map<string, PrintFootprint> {
	const m = new Map<string, PrintFootprint>();
	for (const [slug, s] of Object.entries(shapes)) {
		const b = bbox(s.mesh);
		m.set(slug, {
			slug,
			pieces: [
				{
					name: slug,
					w: b.x1 - b.x0,
					d: b.y1 - b.y0,
					h: b.z1,
					copies: s.copies,
					tris: s.mesh.indices.length / 3,
					mesh: `${slug}.bin`,
					settings: SETTINGS[slug]
				}
			]
		});
	}
	return m;
}
const io = (shapes = SHAPES): WriterIo => ({
	readMesh: (f) => shapes[f.replace(/\.bin$/, '')].mesh
});

function viewFor(slugs = Object.keys(SHAPES)): BuildView {
	const v = makeView();
	v.parts = v.parts.filter((p) => slugs.includes(p.slug));
	v.printer = cc;
	return v;
}
function plan(opts: Partial<Parameters<typeof buildExportPlan>[0]> = {}) {
	const view = opts.view ?? viewFor();
	const fps = opts.footprints ?? footprints();
	const plates = opts.plates ?? planArrangement(view, fps)!.result.plates;
	return buildExportPlan({ view, plates, footprints: fps, flavor: 'orca', ...opts });
}
async function collect(g: AsyncGenerator<Uint8Array>) {
	const chunks: Uint8Array[] = [];
	for await (const c of g) chunks.push(c);
	const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
	let o = 0;
	for (const c of chunks) {
		out.set(c, o);
		o += c.length;
	}
	return { bytes: out, chunks };
}
const text = (z: Record<string, Uint8Array>, name: string) => strFromU8(z[name]);

// ---- plate offsets (values derived from OrcaSlicer PartPlate.cpp, see plate-grid.ts)

describe('plate grid (OrcaSlicer PartPlateList)', () => {
	it('column count follows compute_colum_count', () => {
		expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 25, 26].map(plateColumns)).toEqual([
			1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 5, 5, 6
		]);
	});
	it('origins use a 1.2x stride, plates go right then down (negative y)', () => {
		const o = (i: number, n: number) => plateOrigin(i, n, 256, 256);
		expect(o(0, 1)).toEqual({ x: 0, y: 0 });
		expect(o(1, 2)).toEqual({ x: 307.2, y: 0 });
		// 3 plates: 2 columns, the third wraps to the row below
		expect(o(2, 3).x).toBeCloseTo(0);
		expect(o(2, 3).y).toBeCloseTo(-307.2);
		// 5 plates: 3 columns
		expect(o(4, 5).x).toBeCloseTo(307.2);
		expect(o(4, 5).y).toBeCloseTo(-307.2);
		expect(plateOrigin(1, 2, 220, 200)).toEqual({ x: 264, y: 0 });
		expect(plateOrigin(2, 4, 220, 200).y).toBeCloseTo(-240);
	});
	it('the item transform is a row-vector Rz plus translation', () => {
		const t = itemTransform(
			{ objectId: 1, instanceId: 0, x: 10, y: 20, w: 1, d: 1, rotation: 90 },
			300,
			-300
		);
		expect(t.split(' ').map(Number)).toEqual([0, 1, 0, -1, 0, 0, 0, 0, 1, 310, -280, 0]);
		// [1 0 0 1]*M = (0*1 + ..) -> x' = m00 + tx = 0 + 310, y' = m01 + ty = 1 - 280: R(90) maps +x to +y
	});
});

describe('plan', () => {
	it('maps roles to slots in the build filament order', () => {
		const p = plan();
		const view = viewFor();
		expect(p.filaments.map((f) => f.key)).toEqual(view.filaments.map((f) => f.key));
		for (const o of p.objects) {
			const role = view.parts.find((x) => x.slug === o.slug)!.role;
			expect(o.filamentIndex).toBe(view.filaments.findIndex((f) => f.key === role) + 1);
		}
		expect(p.filaments.filter((f) => f.used).length).toBeGreaterThan(0);
	});

	it('recoloring a part moves it to another plate and another slot', () => {
		const before = plan();
		const view = viewFor();
		const wing = view.parts.find((p) => p.slug === 'wing-left')!;
		const other = view.filaments.find((f) => f.key !== wing.role && !f.tpu)!;
		wing.role = other.key;
		const after = plan({ view });
		const slotOf = (pl: typeof before, slug: string) =>
			pl.objects.find((o) => o.slug === slug)!.filamentIndex;
		expect(slotOf(after, 'wing-left')).toBe(view.filaments.indexOf(other) + 1);
		expect(slotOf(after, 'wing-left')).not.toBe(slotOf(before, 'wing-left'));
		const plateOf = (pl: typeof before, slug: string) => {
			const id = pl.objects.find((o) => o.slug === slug)!.id;
			return pl.plates.find((x) => x.items.some((i) => i.objectId === id))!;
		};
		expect(plateOf(after, 'wing-left').roles).toContain(other.key);
	});

	it('warns when a plate needs more filaments than the printer has slots', () => {
		const view = viewFor();
		view.printer = { ...cc, mmSlots: 1 };
		const plates = planArrangement({ ...view, printer: { ...cc, mmSlots: 4 } }, footprints())!
			.result.plates;
		const merged: ArrangedPlate = {
			...plates[0],
			roles: ['primary', 'accent'],
			items: plates.flatMap((p) => p.items).slice(0, 2)
		};
		const p = buildExportPlan({ view, plates: [merged], footprints: footprints(), flavor: 'orca' });
		const w = p.warnings.find((x) => x.code === 'slots' && x.plate === merged.number);
		expect(w?.severity).toBe('error');
		expect(w?.message).toMatch(/needs 2 filaments/);
	});

	it('skips parts without geometry, with a warning, and reports them', () => {
		const fps = footprints();
		fps.set('footrest', {
			...fps.get('footrest')!,
			pieces: [{ ...fps.get('footrest')!.pieces[0], mesh: undefined }]
		});
		const p = plan({ footprints: fps });
		expect(p.missing.map((m) => m.slug)).toEqual(['footrest']);
		expect(p.warnings.some((w) => w.code === 'no-geometry' && /Footrest/i.test(w.message))).toBe(
			true
		);
		expect(p.objects.some((o) => o.slug === 'footrest')).toBe(false);
	});

	it('exports only the selected plates and rejects unknown ones', () => {
		const all = plan();
		const second = all.plates[1].number;
		const one = plan({ selected: [second] });
		expect(one.plates).toHaveLength(1);
		expect(one.plates[0].number).toBe(second);
		expect(one.plates[0].index).toBe(1);
		expect(() => plan({ selected: [999] })).toThrow(/no plate 999/);
	});

	it('needs a printer', () => {
		const view = viewFor();
		view.printer = null;
		expect(() => plan({ view, plates: [] })).toThrow(/printer/i);
	});
});

describe('project writer (orca, bambu)', () => {
	for (const flavor of ['orca', 'bambu'] as const) {
		it(`${flavor}: round-trips through our 3MF parser`, async () => {
			const p = plan({ flavor });
			const { bytes } = await collect(writeThreeMf(p, p.plates, io()));
			const sum = await parseThreeMfBytes(bytes);
			expect(sum.kind).toBe('project');
			expect(sum.app).toBe(flavor === 'orca' ? 'OrcaSlicer-1.9.0' : 'BambuStudio-01.10.00.00');
			expect(sum.plates.map((x) => x.name)).toEqual(p.plates.map((x) => x.name));
			expect(sum.plates.map((x) => x.index)).toEqual(p.plates.map((x) => x.index));
			expect(sum.filaments.map((f) => f.color)).toEqual(p.filaments.map((f) => f.hex));
			expect(sum.filaments.map((f) => f.type)).toEqual(p.filaments.map((f) => f.type));
			expect(sum.nozzle).toBe(0.4);
			expect(sum.printer).toBe('Elegoo Centauri Carbon');
			for (const pl of p.plates) {
				const got = sum.plates.find((x) => x.index === pl.index)!;
				const copies = got.objects.reduce((a, o) => a + o.count, 0);
				expect(copies).toBe(pl.items.length);
				for (const o of got.objects) {
					const planned = p.objects.find((x) => x.name === o.name)!;
					expect(o.filamentIndex).toBe(planned.filamentIndex);
				}
			}
		});
	}

	it('writes per-object MakeGood settings and the build filament, not the author extruder', async () => {
		const p = plan();
		const { bytes } = await collect(writeThreeMf(p, p.plates, io()));
		const z = unzipSync(bytes);
		const ms = text(z, 'Metadata/model_settings.config');
		const wing = p.objects.find((o) => o.slug === 'wing-left')!;
		const block = ms.slice(
			ms.indexOf(`<object id="${wing.id}">`),
			ms.indexOf('</object>', ms.indexOf(`<object id="${wing.id}">`))
		);
		for (const kv of [
			'wall_loops" value="4"',
			'sparse_infill_density" value="20%"',
			'enable_support" value="1"',
			'support_type" value="tree(auto)"',
			'brim_type" value="outer_only"',
			'brim_width" value="5"',
			`key="extruder" value="${wing.filamentIndex}"`
		])
			expect(block).toContain(kv);
		// the author's extruder 1 is not written a second time
		expect(block.match(/key="extruder"/g)!.length).toBe(2); // object + part
		expect(Object.keys(z)).toEqual(
			expect.arrayContaining([
				'[Content_Types].xml',
				'_rels/.rels',
				'3D/3dmodel.model',
				'Metadata/model_settings.config',
				'Metadata/project_settings.config',
				'Metadata/slice_info.config',
				'Metadata/tmt_export_notes.txt'
			])
		);
		const ps = JSON.parse(text(z, 'Metadata/project_settings.config'));
		expect(ps.printable_area).toEqual(['0x0', '256x0', '256x256', '0x256']);
		expect(ps.filament_settings_id[0]).toMatch(/^Generic /);
		expect(ps.layer_height).toBe('0.2');
	});

	it('geometry sanity: items inside their plate bed after the offset, no overlaps, on z = 0', async () => {
		// enough copies for several plates
		const shapes = { ...SHAPES, 'wing-left': { mesh: cube(200, 90, 20), copies: 1 } };
		const fps = footprints(shapes);
		const view = viewFor();
		view.parts.find((p) => p.slug === 'wing-left')!.qty = 6;
		view.parts.find((p) => p.slug === 'wing-right')!.qty = 6;
		const p = plan({ view, footprints: fps });
		expect(p.plates.length).toBeGreaterThan(2);
		const { bytes } = await collect(writeThreeMf(p, p.plates, io(shapes)));
		const z = unzipSync(bytes);
		const model = text(z, '3D/3dmodel.model');
		const meshes = new Map<number, PrintMesh>();
		for (const o of p.objects) meshes.set(o.id, shapes[o.slug as keyof typeof shapes].mesh);
		const items = [...model.matchAll(/<item objectid="(\d+)" transform="([^"]+)"/g)].map((m) => ({
			obj: Number(m[1]),
			t: m[2].split(' ').map(Number)
		}));
		expect(items).toHaveLength(p.plates.reduce((a, pl) => a + pl.items.length, 0));
		type Box = { x0: number; x1: number; y0: number; y1: number };
		const perPlate = new Map<number, Box[]>();
		for (const it of items) {
			const mesh = meshes.get(it.obj)!;
			const [m00, m01, , m10, m11, , , , , tx, ty, tz] = it.t;
			expect(tz).toBe(0);
			const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
			let minZ = Infinity;
			for (let i = 0; i < mesh.positions.length; i += 3) {
				const x = mesh.positions[i];
				const y = mesh.positions[i + 1];
				const X = x * m00 + y * m10 + tx;
				const Y = x * m01 + y * m11 + ty;
				b.x0 = Math.min(b.x0, X);
				b.x1 = Math.max(b.x1, X);
				b.y0 = Math.min(b.y0, Y);
				b.y1 = Math.max(b.y1, Y);
				minZ = Math.min(minZ, mesh.positions[i + 2]);
			}
			expect(minZ).toBe(0);
			// which plate: the one whose bed contains the box centre
			const cx = (b.x0 + b.x1) / 2;
			const cy = (b.y0 + b.y1) / 2;
			const plate = p.plates.find(
				(pl) =>
					cx >= pl.originX && cx <= pl.originX + 256 && cy >= pl.originY && cy <= pl.originY + 256
			);
			expect(plate, 'item centre lies on some plate').toBeTruthy();
			const e = 1e-3;
			expect(b.x0).toBeGreaterThanOrEqual(plate!.originX - e);
			expect(b.x1).toBeLessThanOrEqual(plate!.originX + 256 + e);
			expect(b.y0).toBeGreaterThanOrEqual(plate!.originY - e);
			expect(b.y1).toBeLessThanOrEqual(plate!.originY + 256 + e);
			const list = perPlate.get(plate!.index) ?? [];
			for (const o of list)
				expect(b.x1 <= o.x0 + e || b.x0 >= o.x1 - e || b.y1 <= o.y0 + e || b.y0 >= o.y1 - e).toBe(
					true
				);
			list.push(b);
			perPlate.set(plate!.index, list);
		}
		// every plate got its own items (the instance lists agree with the positions)
		const ms = text(z, 'Metadata/model_settings.config');
		for (const pl of p.plates) {
			const start = ms.indexOf(`<metadata key="plater_id" value="${pl.index}"/>`);
			const end = ms.indexOf('</plate>', start);
			expect(ms.slice(start, end).match(/<model_instance>/g)!.length).toBe(pl.items.length);
			expect(perPlate.get(pl.index)!.length).toBe(pl.items.length);
		}
	});

	it('triangle winding is kept (signed volume stays positive after rotation)', async () => {
		const p = plan();
		const { bytes } = await collect(writeThreeMf(p, p.plates, io()));
		const model = text(unzipSync(bytes), '3D/3dmodel.model');
		for (const o of p.objects) {
			const seg = model.slice(
				model.indexOf(`<object id="${o.id}"`),
				model.indexOf('</object>', model.indexOf(`<object id="${o.id}"`))
			);
			const v = [...seg.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map((m) => [
				+m[1],
				+m[2],
				+m[3]
			]);
			const t = [...seg.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((m) => [
				+m[1],
				+m[2],
				+m[3]
			]);
			let vol = 0;
			for (const [a, b, c] of t) {
				const [A, B, C] = [v[a], v[b], v[c]];
				vol +=
					(A[0] * (B[1] * C[2] - B[2] * C[1]) -
						A[1] * (B[0] * C[2] - B[2] * C[0]) +
						A[2] * (B[0] * C[1] - B[1] * C[0])) /
					6;
			}
			expect(vol).toBeGreaterThan(0);
		}
	});

	it('lists skipped parts in the notes file', async () => {
		const fps = footprints();
		fps.set('footrest', {
			...fps.get('footrest')!,
			pieces: [{ ...fps.get('footrest')!.pieces[0], mesh: undefined }]
		});
		const p = plan({ footprints: fps });
		const { bytes } = await collect(writeThreeMf(p, p.plates, io()));
		const notes = text(unzipSync(bytes), 'Metadata/tmt_export_notes.txt');
		expect(notes).toContain('Left out (no print geometry imported)');
		expect(notes).toContain('footrest');
	});

	it('streams: many bounded chunks, the model never sits in one buffer', async () => {
		// a 160k triangle sphere-ish mesh (grid)
		const n = 300;
		const pos = new Float32Array((n + 1) * (n + 1) * 3);
		for (let j = 0; j <= n; j++)
			for (let i = 0; i <= n; i++) {
				const k = (j * (n + 1) + i) * 3;
				pos[k] = i * 0.5 - 75;
				pos[k + 1] = j * 0.5 - 75;
				pos[k + 2] = Math.sin(i / 7) * Math.cos(j / 9) + 1.5;
			}
		const idx = new Uint32Array(n * n * 6);
		let o = 0;
		for (let j = 0; j < n; j++)
			for (let i = 0; i < n; i++) {
				const a = j * (n + 1) + i;
				idx.set([a, a + 1, a + n + 2, a, a + n + 2, a + n + 1], o);
				o += 6;
			}
		const shapes = { 'wing-left': { mesh: { positions: pos, indices: idx }, copies: 1 } };
		const view = viewFor(['wing-left']);
		const p = plan({ view, footprints: footprints(shapes) });
		let produced = 0;
		let maxChunk = 0;
		let count = 0;
		let firstAt = -1;
		for await (const c of writeThreeMf(p, p.plates, io(shapes))) {
			produced += c.length;
			maxChunk = Math.max(maxChunk, c.length);
			count++;
			if (firstAt < 0) firstAt = produced;
		}
		expect(produced).toBeGreaterThan(300_000);
		expect(count).toBeGreaterThan(10);
		expect(maxChunk).toBeLessThan(produced / 5);
		// the web stream wrapper delivers the same bytes and honours cancel
		const rs = toWebStream(writeThreeMf(p, p.plates, io(shapes)));
		const reader = rs.getReader();
		await reader.read();
		await reader.cancel();
	});
});

describe('plain flavor', () => {
	it('is one 3MF per plate with the filament in the object name and PrusaSlicer extruders', async () => {
		const p = plan({ flavor: 'plain' });
		expect(p.plates.every((pl) => pl.originX === 0 && pl.originY === 0)).toBe(true);
		const { bytes } = await collect(writeThreeMf(p, [p.plates[0]], io()));
		const sum = await parseThreeMfBytes(bytes);
		expect(sum.kind).toBe('plain');
		const used = new Set(p.plates[0].items.map((i) => i.objectId));
		expect(sum.plates[0].objects.reduce((a, o) => a + o.count, 0)).toBe(p.plates[0].items.length);
		const f = (k: string) => p.filaments.find((x) => x.key === k)!;
		for (const o of sum.plates[0].objects) {
			const planned = p.objects.find((x) => used.has(x.id) && o.name.startsWith(x.name))!;
			const fl = f(planned.role);
			expect(o.name).toBe(`${planned.name} [${fl.label} ${fl.material} - ${fl.name}]`);
		}
		const cfg = text(unzipSync(bytes), 'Metadata/Slic3r_PE_model.config');
		expect(cfg).toMatch(/key="extruder" value="\d"/);
		expect(Object.keys(unzipSync(bytes))).not.toContain('Metadata/model_settings.config');
	});

	it('several plates make a zip of valid 3MFs, a single plate a plain 3MF', async () => {
		const p = plan({ flavor: 'plain' });
		expect(p.plates.length).toBeGreaterThan(1);
		const { bytes } = await collect(writePlainZip(p, io()));
		const z = unzipSync(bytes);
		const files = Object.keys(z).filter((n) => n.endsWith('.3mf'));
		expect(files).toHaveLength(p.plates.length);
		for (const [i, f] of files.sort().entries()) {
			const s = await parseThreeMfBytes(z[f]);
			expect(s.plates[0].objects.reduce((a, o) => a + o.count, 0)).toBe(p.plates[i].items.length);
		}
		expect(Object.keys(z)).toContain('README.txt');
		expect(exportFilename(p)).toMatch(/^TMT-Test-build-Elegoo-Centauri-Carbon-plain\.zip$/);
		const one = plan({ flavor: 'plain', selected: [p.plates[1].number] });
		expect(exportFilename(one)).toMatch(/plain-plate\d+\.3mf$/);
		const oneOrca = plan({ flavor: 'orca', selected: [p.plates[1].number] });
		expect(exportFilename(oneOrca)).toMatch(/orca-plate\d+\.3mf$/);
		const single = (await collect(writeThreeMf(one, one.plates, io()))).bytes;
		expect((await parseThreeMfBytes(single)).kind).toBe('plain');
	});
});

// ---- through the database (access, arrangement, files on disk)

describe('exportBuild3mf with a database', () => {
	let db: Db;
	let templateId: string;
	const orgId = 'org1';
	beforeEach(() => {
		db = openDb(':memory:');
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		templateId = db.select({ id: templates.id }).from(templates).get()!.id;
		db.insert(organization)
			.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
			.run();
		for (const [u, role] of [
			['owner', 'owner'],
			['viewer', 'viewer'],
			['outsider', '']
		]) {
			db.insert(user)
				.values({ id: u, name: u, email: `${u}@example.test`, createdAt: new Date() })
				.run();
			if (role)
				db.insert(member)
					.values({ id: `m-${u}`, organizationId: orgId, userId: u, role, createdAt: new Date() })
					.run();
		}
	});
	const mk = () =>
		createBuild(db, { organizationId: orgId, templateId, designId: null, name: 'Chair' }, 'owner');
	function importSynthetic() {
		const parts: ExtractedPart[] = Object.entries(SHAPES).map(([slug, s]) => {
			const b = bbox(s.mesh);
			return {
				slug,
				unitsPerPlate: 1,
				plate: 1,
				runsHint: 1,
				pieces: [
					{
						name: slug,
						objectId: '1',
						copies: 1,
						onPlate: 1,
						filamentIndex: 1,
						settings: SETTINGS[slug] ?? {},
						geometry: {
							objectId: '1',
							positions: s.mesh.positions,
							indices: s.mesh.indices,
							w: b.x1 - b.x0,
							d: b.y1 - b.y0,
							h: b.z1,
							placedW: b.x1 - b.x0,
							placedD: b.y1 - b.y0,
							angleDeg: 0,
							hull: [
								[b.x0, b.y0],
								[b.x1, b.y0],
								[b.x1, b.y1],
								[b.x0, b.y1]
							],
							tris: s.mesh.indices.length / 3
						}
					}
				]
			};
		});
		storeExtractedParts(db, templateId, parts, 'synthetic.3mf');
	}

	it('400 without a printer, 404 for outsiders, 409 without geometry, then a zip for viewers', async () => {
		const id = mk();
		const err = (f: () => unknown) => {
			try {
				f();
			} catch (e) {
				return e as ApiError;
			}
			throw new Error('did not throw');
		};
		expect(err(() => exportBuild3mf(db, id, 'owner', { flavor: 'orca' })).status).toBe(400);
		setPrinter(db, id, 'owner', { printer: cc });
		expect(err(() => exportBuild3mf(db, id, 'outsider', { flavor: 'orca' })).status).toBe(404);
		expect(err(() => exportBuild3mf(db, id, 'owner', { flavor: 'orca' })).status).toBe(409);
		const pre0 = previewExport(db, id, 'owner', { flavor: 'orca' });
		expect(pre0.ready).toBe(false);
		expect(pre0.reason).toBe('no-geometry');

		importSynthetic();
		const out = exportBuild3mf(db, id, 'viewer', { flavor: 'orca' });
		expect(out.filename).toBe('TMT-Chair-Elegoo-Centauri-Carbon-orca.3mf');
		expect(out.contentType).toBe('model/3mf');
		const chunks: Uint8Array[] = [];
		const reader = out.stream.getReader();
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			chunks.push(value);
		}
		const bytes = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
		let o = 0;
		for (const c of chunks) {
			bytes.set(c, o);
			o += c.length;
		}
		const sum = await parseThreeMfBytes(bytes);
		expect(sum.kind).toBe('project');
		const names = sum.plates.flatMap((p) => p.objects.map((x) => x.name));
		expect(names).toEqual(expect.arrayContaining(['Wing Left', 'Wing Right', 'Footrest']));

		const pre = previewExport(db, id, 'viewer', { flavor: 'orca' });
		expect(pre.ready).toBe(true);
		expect(pre.plates.length).toBe(sum.plates.length);
		expect(pre.missing.length).toBeGreaterThan(0); // the other kit parts have seed numbers only
		expect(pre.filaments).toHaveLength(4);
		// not arranged yet: a note says the export used a fresh arrangement
		expect(pre.warnings.some((w) => w.code === 'arrangement')).toBe(true);
		expect(
			prepareExport(db, id, 'owner', { flavor: 'orca', plates: [pre.plates[0].number] }).plan.plates
		).toHaveLength(1);
		expect(() => prepareExport(db, id, 'owner', { flavor: 'orca', plates: [999] })).toThrow(
			/plate 999/
		);
		const v = loadBuildView(db, id, 'owner')!;
		expect(v.printer?.name).toBe('Elegoo Centauri Carbon');
	});

	it('a null item in a stored arrangement does not throw (re-arranges instead)', () => {
		const id = mk();
		setPrinter(db, id, 'owner', { printer: cc });
		importSynthetic();
		const row = db.select().from(buildPlates).where(eq(buildPlates.buildId, id)).all()[0];
		if (row?.arrangement) {
			const bad = { ...row.arrangement, items: [null, ...row.arrangement.items] } as never;
			db.update(buildPlates)
				.set({ arrangement: bad })
				.where(and(eq(buildPlates.buildId, id), eq(buildPlates.number, row.number)))
				.run();
		}
		expect(() => prepareExport(db, id, 'owner', { flavor: 'orca' })).not.toThrow();
	});
});

// Writes synthetic exports for manual checks (Orca CLI): TMT_EXPORT_DUMP=/dir npx vitest run ...
describe.skipIf(!process.env.TMT_EXPORT_DUMP)('dump synthetic exports', () => {
	it('writes orca, bambu and plain files', async () => {
		const { mkdirSync, writeFileSync } = await import('node:fs');
		const dir = process.env.TMT_EXPORT_DUMP!;
		mkdirSync(dir, { recursive: true });
		for (const flavor of ['orca', 'bambu', 'plain'] as const) {
			const p = plan({ flavor });
			const { bytes } = await collect(
				flavor === 'plain' ? writePlainZip(p, io()) : writeThreeMf(p, p.plates, io())
			);
			writeFileSync(join(dir, `synthetic-${flavor}.${flavor === 'plain' ? 'zip' : '3mf'}`), bytes);
			expect(bytes.length).toBeGreaterThan(0);
		}
	});
});

describe('oversize parts stay flat', () => {
	const slab = cube(320, 190, 20);
	const shapes = { 'wing-left': { mesh: slab, copies: 1 } };
	const fps = footprints(shapes);
	const view = viewFor(['wing-left']);

	// Hard rule (maintainer, 2026-11-04): never change which face is down; only flat rotations.
	it('never tips a part: the transform only rotates about z and the part stays flat', async () => {
		const p = plan({ view, footprints: fps });
		expect(p.plates).toHaveLength(1);
		const item = p.plates[0].items[0];
		expect(Object.keys(item)).not.toContain('pose');
		const { bytes } = await collect(writeThreeMf(p, p.plates, io(shapes)));
		const z = unzipSync(bytes);
		const model = text(z, '3D/3dmodel.model');
		const t = /<item objectid="1" transform="([^"]+)"/.exec(model)![1].split(' ').map(Number);
		// row-vector 3x4: the z axis maps to z and nothing else feeds z (no tilt, no flip)
		expect(t[2]).toBeCloseTo(0, 6);
		expect(t[5]).toBeCloseTo(0, 6);
		expect(t[6]).toBeCloseTo(0, 6);
		expect(t[7]).toBeCloseTo(0, 6);
		expect(t[8]).toBeCloseTo(1, 6);
		const notes = text(z, 'Metadata/tmt_export_notes.txt');
		expect(notes).not.toContain('Re-oriented parts');
	});
});

describe('placement guard with an asymmetric tilted part', () => {
	// right triangle prism 300 x 20: only fits the 256 bed turned across the diagonal; its box
	// centre is not the mesh origin after the turn
	const tri: PrintMesh = {
		positions: new Float32Array([
			-150, -10, 0, 150, -10, 0, -150, 10, 0, -150, -10, 10, 150, -10, 10, -150, 10, 10
		]),
		indices: new Uint32Array([
			0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5
		])
	};
	const shapes = { 'wing-left': { mesh: tri, copies: 1 } };
	const fps = footprints(shapes);
	fps.get('wing-left')!.pieces[0].hull = [
		[-150, -10],
		[150, -10],
		[-150, 10]
	];
	it('keeps the real mesh on the plate (pivot is the box centre, not the mesh origin)', () => {
		const p = plan({ view: viewFor(['wing-left']), footprints: fps });
		const item = p.plates[0].items[0];
		expect(item.rotation % 90).not.toBe(0);
		const g = checkPlacement(p, (f) => shapes[f.replace(/\.bin$/, '') as 'wing-left'].mesh);
		expect(g.warnings).toEqual([]);
		const b = g.placed[0];
		expect(b.x0).toBeGreaterThanOrEqual(-0.3);
		expect(b.x1).toBeLessThanOrEqual(256.3);
		expect(b.y0).toBeGreaterThanOrEqual(-0.3);
		expect(b.y1).toBeLessThanOrEqual(256.3);
		expect(b.z0).toBeCloseTo(0, 6);
	});
	it('the guard reports an item that leaves the bed', () => {
		const p = plan({ view: viewFor(['wing-left']), footprints: fps });
		p.plates[0].items[0].x += 40;
		const g = checkPlacement(p, (f) => shapes[f.replace(/\.bin$/, '') as 'wing-left'].mesh);
		expect(g.warnings.some((w) => w.severity === 'error' && /reaches/.test(w.message))).toBe(true);
	});
});

describe('painted supports survive the export', () => {
	it('writes paint_supports / paint_seam on the same triangles, counts match, notes list them', async () => {
		const mesh: PrintMesh = {
			...cube(100, 50, 20),
			paint: [
				{ kind: 'supports', tri: 3, value: '4C' },
				{ kind: 'supports', tri: 7, value: '8' },
				{ kind: 'seam', tri: 7, value: '4' }
			]
		};
		const shapes = { 'wing-left': { mesh, copies: 1 } };
		const fps = footprints(shapes);
		fps.get('wing-left')!.pieces[0].partSettings = { support_filament: '2' };
		const p = plan({ view: viewFor(['wing-left']), footprints: fps });
		const { bytes } = await collect(writeThreeMf(p, p.plates, io(shapes)));
		const z = unzipSync(bytes);
		const model = text(z, '3D/3dmodel.model');
		const tris = [...model.matchAll(/<triangle [^>]*>/g)].map((m) => m[0]);
		expect(tris).toHaveLength(12);
		expect(tris.filter((t) => t.includes('paint_supports=')).length).toBe(2);
		expect(tris.filter((t) => t.includes('paint_seam=')).length).toBe(1);
		expect(tris[3]).toContain('paint_supports="4C"');
		expect(tris[7]).toContain('paint_supports="8"');
		expect(tris[7]).toContain('paint_seam="4"');
		expect(text(z, 'Metadata/tmt_export_notes.txt')).toContain('3 painted triangles');
		expect(text(z, 'Metadata/model_settings.config')).toContain('key="support_filament" value="2"');
	});
	it('the plain flavor has no paint attributes', async () => {
		const mesh: PrintMesh = {
			...cube(100, 50, 20),
			paint: [{ kind: 'supports', tri: 3, value: '4C' }]
		};
		const shapes = { 'wing-left': { mesh, copies: 1 } };
		const p = plan({
			view: viewFor(['wing-left']),
			footprints: footprints(shapes),
			flavor: 'plain'
		});
		const { bytes } = await collect(writeThreeMf(p, p.plates, io(shapes)));
		expect(text(unzipSync(bytes), '3D/3dmodel.model')).not.toContain('paint_');
	});
});

describe('keep-out areas in the export', () => {
	it('writes bed_exclude_area in Orca point format', async () => {
		const p = plan({ flavor: 'orca' });
		const { bytes } = await collect(writeThreeMf(p, p.plates, io()));
		const ps = JSON.parse(text(unzipSync(bytes), 'Metadata/project_settings.config'));
		expect(ps.bed_exclude_area).toEqual(['246x0', '256x0', '256x20', '246x20']);
		expect(text(unzipSync(bytes), 'Metadata/tmt_export_notes.txt')).toMatch(/Filament cutter/);
	});
	it('does not write it for a printer without a keep-out', async () => {
		const view = viewFor();
		view.printer = { ...cc, keepOut: [] };
		const p = plan({ view });
		const { bytes } = await collect(writeThreeMf(p, p.plates, io()));
		const ps = JSON.parse(text(unzipSync(bytes), 'Metadata/project_settings.config'));
		expect(ps.bed_exclude_area).toBeUndefined();
	});
	it('notes the one-polygon limit when there are several zones', async () => {
		const view = viewFor();
		view.printer = {
			...cc,
			keepOut: [...cc.keepOut!, { x: 0, y: 236, w: 20, d: 20, label: 'Purge corner' }]
		};
		const p = plan({ view });
		const { bytes } = await collect(writeThreeMf(p, p.plates, io()));
		expect(text(unzipSync(bytes), 'Metadata/tmt_export_notes.txt')).toMatch(/one excluded area/);
	});
	it('the guard accepts arranged items and flags a mesh inside the zone', () => {
		const readMesh = (f: string) => SHAPES[f.replace(/\.bin$/, '')].mesh;
		const p = plan({ view: viewFor(['push-pin', 'wing-left']) });
		expect(checkPlacement(p, readMesh).warnings).toEqual([]);
		const pin = p.plates
			.flatMap((pl) => pl.items)
			.find((i) => i.objectId === p.objects.find((o) => o.slug === 'push-pin')!.id)!;
		pin.x = 250;
		pin.y = 10;
		const g = checkPlacement(p, readMesh);
		expect(
			g.warnings.some((w) => w.severity === 'error' && /Filament cutter/.test(w.message))
		).toBe(true);
	});
});
