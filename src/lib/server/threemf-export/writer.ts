/**
 * Streaming 3MF writer. Produces the zip as an async generator of chunks (fflate `Zip` +
 * `ZipDeflate`); meshes are read and written one object at a time and never collected, so
 * memory stays flat whatever the project's size. Formats:
 *
 * - `orca` / `bambu`: one project file with all plates in one build volume (plate offsets
 *   from `plate-grid.ts`), `Metadata/model_settings.config`, `project_settings.config`,
 *   `slice_info.config` (header only). Objects have one `<object>` per part piece; copies
 *   are build items (instances), exactly like the slicers store duplicates.
 * - `plain`: a standard 3MF per plate, items at bed coordinates, filament in the object name
 *   plus PrusaSlicer's `Metadata/Slic3r_PE_model.config` (extruder per object).
 */
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { PrintMesh } from '../print-geometry/mesh-format';
import {
	plainObjectName,
	type ExportPlan,
	type PlanFilament,
	type PlannedItem,
	type PlannedObject,
	type PlannedPlate
} from './plan';
import { catalogPrinterName } from './settings';

export interface WriterIo {
	/** Decoded mesh for a stored mesh file name of the plan's template. */
	readMesh(meshFile: string): PrintMesh;
}

export interface WriteOptions {
	/** Deflate level for the model (default 3: ~3x smaller than raw, fast on big meshes). */
	level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
	/** Fixed timestamp for the zip entries (tests). */
	mtime?: Date;
}

const APP: Record<'orca' | 'bambu' | 'plain', string> = {
	// Deliberately old version numbers: slicers warn about files newer than themselves (OrcaSlicer's
	// Plater.cpp compares the Application version with its own), never about older ones. Elegoo Slicer
	// and other forks number themselves differently from OrcaSlicer.
	orca: 'OrcaSlicer-1.9.0',
	bambu: 'BambuStudio-01.10.00.00',
	plain: 'TMT-Build-Tracker'
};

export const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Short decimal, no exponent, no "-0". */
export function num(v: number): string {
	const r = Math.round(v * 1e4) / 1e4;
	return Object.is(r, -0) ? '0' : String(r);
}

class Sink {
	zip = new Zip();
	private queue: Uint8Array[] = [];
	constructor() {
		this.zip.ondata = (err, chunk) => {
			if (err) throw err;
			this.queue.push(chunk);
		};
	}
	take(): Uint8Array[] {
		const q = this.queue;
		this.queue = [];
		return q;
	}
}

class Entry {
	private f: ZipDeflate | ZipPassThrough;
	constructor(
		private sink: Sink,
		name: string,
		level: number,
		mtime?: Date
	) {
		this.f = level === 0 ? new ZipPassThrough(name) : new ZipDeflate(name, { level: level as 1 });
		if (mtime) this.f.mtime = mtime;
		sink.zip.add(this.f);
	}
	/** Push data; the caller yields `sink.take()` afterwards. */
	push(data: Uint8Array, final = false) {
		this.f.push(data, final);
	}
}

const enc = new TextEncoder();

async function* addText(sink: Sink, name: string, text: string, level: number, mtime?: Date) {
	const e = new Entry(sink, name, level, mtime);
	e.push(enc.encode(text), true);
	yield* sink.take();
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
 <Default Extension="txt" ContentType="text/plain"/>
</Types>
`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

/** 3MF transform: row-vector matrix `[x y z 1] * M`, so Rz(a) is `cos sin 0 / -sin cos 0 / 0 0 1`. */
export function itemTransform(it: PlannedItem, ox: number, oy: number): string {
	const a = (it.rotation * Math.PI) / 180;
	const c = Math.abs(Math.cos(a)) < 1e-12 ? 0 : Math.cos(a);
	const s = Math.abs(Math.sin(a)) < 1e-12 ? 0 : Math.sin(a);
	return [c, s, 0, -s, c, 0, 0, 0, 1, it.x + ox, it.y + oy, 0].map(num).join(' ');
}

/** One file's view of the plan: renumbered objects and plates, offsets applied or not. */
interface FileSpec {
	objects: PlannedObject[];
	plates: PlannedPlate[];
	/** Instance ids restart per file. */
	items: { plate: PlannedPlate; item: PlannedItem; objectId: number; instanceId: number }[];
}

export function fileSpec(
	plan: ExportPlan,
	plates: PlannedPlate[],
	firstObjectId: number
): FileSpec {
	const used = new Set<number>();
	for (const p of plates) for (const i of p.items) used.add(i.objectId);
	const map = new Map<number, number>();
	const objects: PlannedObject[] = [];
	for (const o of plan.objects)
		if (used.has(o.id)) {
			map.set(o.id, firstObjectId + objects.length);
			objects.push({ ...o, id: firstObjectId + objects.length });
		}
	const counts = new Map<number, number>();
	const items: FileSpec['items'] = [];
	for (const p of plates)
		for (const item of p.items) {
			const id = map.get(item.objectId)!;
			const n = counts.get(id) ?? 0;
			counts.set(id, n + 1);
			items.push({ plate: p, item, objectId: id, instanceId: n });
		}
	return { objects, plates, items };
}

async function* writeModel(
	sink: Sink,
	plan: ExportPlan,
	spec: FileSpec,
	io: WriterIo,
	opts: WriteOptions,
	triCounts: Map<number, number>,
	project: boolean
) {
	const e = new Entry(sink, '3D/3dmodel.model', opts.level ?? 3, opts.mtime);
	const title = esc(`${plan.buildName} - ${plan.printer.name}`);
	const head = project
		? `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <metadata name="Application">${APP[plan.flavor]}</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${title}</metadata>
 <metadata name="Designer">TMT Build Tracker</metadata>
 <resources>
`
		: `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">${APP.plain}</metadata>
 <metadata name="Title">${title}</metadata>
 <resources>
`;
	e.push(enc.encode(head));
	yield* sink.take();
	const VERTS = 4000;
	for (const o of spec.objects) {
		const mesh = io.readMesh(o.meshFile);
		const nv = mesh.positions.length / 3;
		const nt = mesh.indices.length / 3;
		triCounts.set(o.id, nt);
		const name = plan.flavor === 'plain' ? plainObjectName(o, fil(plan, o)) : o.name;
		e.push(
			enc.encode(
				`  <object id="${o.id}" name="${esc(name)}" type="model">\n   <mesh>\n    <vertices>\n`
			)
		);
		yield* sink.take();
		for (let v0 = 0; v0 < nv; v0 += VERTS) {
			const parts: string[] = [];
			const end = Math.min(nv, v0 + VERTS);
			for (let v = v0; v < end; v++)
				parts.push(
					`     <vertex x="${num(mesh.positions[v * 3])}" y="${num(mesh.positions[v * 3 + 1])}" z="${num(mesh.positions[v * 3 + 2])}"/>\n`
				);
			e.push(enc.encode(parts.join('')));
			yield* sink.take();
		}
		e.push(enc.encode('    </vertices>\n    <triangles>\n'));
		for (let t0 = 0; t0 < nt; t0 += VERTS) {
			const parts: string[] = [];
			const end = Math.min(nt, t0 + VERTS);
			for (let t = t0; t < end; t++)
				parts.push(
					`     <triangle v1="${mesh.indices[t * 3]}" v2="${mesh.indices[t * 3 + 1]}" v3="${mesh.indices[t * 3 + 2]}"/>\n`
				);
			e.push(enc.encode(parts.join('')));
			yield* sink.take();
		}
		e.push(enc.encode('    </triangles>\n   </mesh>\n  </object>\n'));
		yield* sink.take();
	}
	const build: string[] = [' </resources>\n <build>\n'];
	for (const { plate, item, objectId } of spec.items)
		build.push(
			`  <item objectid="${objectId}" transform="${itemTransform(item, plate.originX, plate.originY)}" printable="1"/>\n`
		);
	build.push(' </build>\n</model>\n');
	e.push(enc.encode(build.join('')), true);
	yield* sink.take();
}

const fil = (plan: ExportPlan, o: PlannedObject): PlanFilament =>
	plan.filaments[o.filamentIndex - 1];

/** Keys MakeGood's settings carry that the export sets itself. */
const OWN_KEYS = new Set(['name', 'extruder', 'module', 'face_count']);

function modelSettings(plan: ExportPlan, spec: FileSpec, tris: Map<number, number>): string {
	const out = ['<?xml version="1.0" encoding="UTF-8"?>\n<config>\n'];
	for (const o of spec.objects) {
		const ext = o.filamentIndex;
		out.push(
			`  <object id="${o.id}">\n    <metadata key="name" value="${esc(o.name)}"/>\n    <metadata key="extruder" value="${ext}"/>\n`
		);
		for (const [k, v] of Object.entries(o.settings))
			if (!OWN_KEYS.has(k) && /^[a-z0-9_]+$/.test(k))
				out.push(`    <metadata key="${k}" value="${esc(v)}"/>\n`);
		out.push(
			`    <part id="${o.id}" subtype="normal_part">\n      <metadata key="name" value="${esc(o.name)}"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n      <metadata key="extruder" value="${ext}"/>\n      <mesh_stat face_count="${tris.get(o.id) ?? 0}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n    </part>\n  </object>\n`
		);
	}
	for (const p of spec.plates) {
		out.push(
			`  <plate>\n    <metadata key="plater_id" value="${p.index}"/>\n    <metadata key="plater_name" value="${esc(p.name)}"/>\n    <metadata key="locked" value="false"/>\n`
		);
		for (const s of spec.items)
			if (s.plate === p)
				out.push(
					`    <model_instance>\n      <metadata key="object_id" value="${s.objectId}"/>\n      <metadata key="instance_id" value="${s.instanceId}"/>\n      <metadata key="identify_id" value="${1000 * s.objectId + s.instanceId + 1}"/>\n    </model_instance>\n`
				);
		out.push('  </plate>\n');
	}
	out.push('</config>\n');
	return out.join('');
}

export function projectSettings(plan: ExportPlan): Record<string, unknown> {
	const p = plan.printer;
	const fils = plan.filaments;
	const w = p.bedX;
	const d = p.bedY;
	const model = catalogPrinterName(p.catalogId);
	const n = fils.length;
	// Per-filament tables the slicers expect to match the filament count (as OrcaSlicer 2.4 writes them).
	const flush = Array.from({ length: n * n }, (_, i) =>
		Math.floor(i / n) === i % n ? '0' : '280'
	);
	return {
		from: 'project',
		name: 'project_settings',
		version: APP[plan.flavor].split('-').slice(1).join('-'),
		layer_height: '0.2',
		nozzle_diameter: [String(p.nozzle || 0.4)],
		printable_area: [`0x0`, `${num(w)}x0`, `${num(w)}x${num(d)}`, `0x${num(d)}`],
		printable_height: num(p.bedZ),
		curr_bed_type: 'Textured PEI Plate',
		filament_colour: fils.map((f) => f.hex),
		filament_type: fils.map((f) => f.type),
		filament_settings_id: fils.map((f) => `Generic ${f.type}`),
		filament_map: fils.map(() => '1'),
		flush_volumes_matrix: flush,
		flush_volumes_vector: Array.from({ length: n * 2 }, () => '140'),
		...(model
			? {
					printer_model: model,
					printer_settings_id: `${model} ${p.nozzle || 0.4} nozzle`
				}
			: {})
	};
}

function notes(plan: ExportPlan): string {
	const lines = [
		`TMT Build Tracker export: ${plan.buildName}`,
		`Printer: ${plan.printer.name} (${plan.printer.bedX} x ${plan.printer.bedY} mm, ${plan.printer.mmSlots} filament slot${plan.printer.mmSlots === 1 ? '' : 's'})`,
		'',
		'Filaments (slot: color)'
	];
	for (const f of plan.filaments)
		lines.push(
			`  ${f.index}: ${f.label} - ${f.name} (${f.material}, ${f.hex})${f.used ? '' : ' [unused]'}`
		);
	lines.push('', 'Plates');
	for (const p of plan.plates)
		lines.push(
			`  ${p.index}: ${p.name} (${p.items.length} item${p.items.length === 1 ? '' : 's'}, build plate ${p.number})`
		);
	if (plan.warnings.length) {
		lines.push('', 'Warnings');
		for (const w of plan.warnings) lines.push(`  - ${w.message}`);
	}
	if (plan.missing.length) {
		lines.push('', 'Left out (no print geometry imported)');
		for (const m of plan.missing) lines.push(`  - ${m.name} (${m.slug})`);
	}
	return lines.join('\n') + '\n';
}

function prusaConfig(plan: ExportPlan, spec: FileSpec, tris: Map<number, number>): string {
	const out = ['<?xml version="1.0" encoding="UTF-8"?>\n<config>\n'];
	for (const o of spec.objects) {
		const n = tris.get(o.id) ?? 1;
		const name = plainObjectName(o, plan.filaments[o.filamentIndex - 1]);
		const copies = spec.items.filter((s) => s.objectId === o.id).length;
		out.push(
			` <object id="${o.id}" instances_count="${copies}">\n  <metadata type="object" key="name" value="${esc(name)}"/>\n  <metadata type="object" key="extruder" value="${o.filamentIndex}"/>\n  <volume firstid="0" lastid="${n - 1}">\n   <metadata type="volume" key="name" value="${esc(name)}"/>\n   <metadata type="volume" key="volume_type" value="ModelPart"/>\n  </volume>\n </object>\n`
		);
	}
	out.push('</config>\n');
	return out.join('');
}

/** Chunks of one 3MF made of `plates` (project flavors: all; plain: one plate). */
export async function* writeThreeMf(
	plan: ExportPlan,
	plates: PlannedPlate[],
	io: WriterIo,
	opts: WriteOptions = {},
	sinkIn?: Sink
): AsyncGenerator<Uint8Array> {
	const project = plan.flavor !== 'plain';
	const sink = sinkIn ?? new Sink();
	const level = opts.level ?? 3;
	// Plain files hold a single plate at the bed's own coordinates.
	const spec = fileSpec(plan, plates, 1);
	yield* addText(sink, '[Content_Types].xml', CONTENT_TYPES, level, opts.mtime);
	yield* addText(sink, '_rels/.rels', RELS, level, opts.mtime);
	const tris = new Map<number, number>();
	yield* writeModel(sink, plan, spec, io, opts, tris, project);
	if (project) {
		yield* addText(
			sink,
			'Metadata/model_settings.config',
			modelSettings(plan, spec, tris),
			level,
			opts.mtime
		);
		yield* addText(
			sink,
			'Metadata/project_settings.config',
			JSON.stringify(projectSettings(plan), null, 2),
			level,
			opts.mtime
		);
		yield* addText(
			sink,
			'Metadata/slice_info.config',
			`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="${APP[plan.flavor].split('-')[1]}"/>\n  </header>\n</config>\n`,
			level,
			opts.mtime
		);
	} else {
		yield* addText(
			sink,
			'Metadata/Slic3r_PE_model.config',
			prusaConfig(plan, spec, tris),
			level,
			opts.mtime
		);
	}
	yield* addText(sink, 'Metadata/tmt_export_notes.txt', notes(plan), level, opts.mtime);
	if (!sinkIn) {
		sink.zip.end();
		yield* sink.take();
	}
}

/** Safe file name part. */
export const slug = (s: string) =>
	s
		.normalize('NFKD')
		.replace(/[^\w\s.-]+/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.slice(0, 60) || 'build';

/** Zip of one plain 3MF per plate, streamed (the inner files are not recompressed). */
export async function* writePlainZip(
	plan: ExportPlan,
	io: WriterIo,
	opts: WriteOptions = {}
): AsyncGenerator<Uint8Array> {
	const outer = new Sink();
	for (const p of plan.plates) {
		const name = `plate-${String(p.index).padStart(2, '0')}-${slug(p.name)}.3mf`;
		const entry = new Entry(outer, name, 0, opts.mtime);
		for await (const chunk of writeThreeMf(plan, [p], io, opts)) {
			entry.push(chunk);
			yield* outer.take();
		}
		entry.push(new Uint8Array(0), true);
		yield* outer.take();
	}
	yield* addText(outer, 'README.txt', notes(plan), 6, opts.mtime);
	outer.zip.end();
	yield* outer.take();
}
