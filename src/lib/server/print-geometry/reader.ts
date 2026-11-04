/**
 * Streaming geometry reader for slicer 3MF files: pulls the meshes of chosen
 * objects out of `3D/Objects/*.model` (the plate parser never inflates those),
 * applies the transforms MakeGood placed them with and returns them dropped to
 * z = 0 and centred, with footprint, hull and per-object settings.
 *
 * Supports the Bambu/Orca layout (build items -> objects with components that
 * point at `3D/Objects/object_N.model` through `p:path`) and plain 3MF files with
 * meshes inline in `3D/3dmodel.model`. The zip is read twice: first the small
 * entries (3dmodel.model, model_settings.config), then only the object files
 * that were chosen. Memory stays near the size of the chosen meshes.
 */
import { Unzip, UnzipInflate, UnzipPassThrough, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { decodeEntities } from '#lib/domain/threemf.ts';
import type { PaintEntry } from './mesh-format';
import {
	bounds,
	convexHull,
	minAreaAngle,
	round1,
	rotatePoints,
	simplifyHull,
	type Pt
} from '#lib/domain/geom2d.ts';

export type Source = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
export type SourceFactory = () => Source;

export interface Component {
	path: string | null;
	objectId: string;
	/** 3MF 3x4 row-vector transform (12 numbers) or null for identity. */
	transform: number[] | null;
}
export interface RawObject {
	id: string;
	components: Component[];
	/** Inline mesh (plain 3MF): vertex xyz and triangle indices. */
	positions?: Float64Array;
	indices?: Uint32Array;
	/** Per-triangle slicer paint (supports, seam) of the inline mesh, by triangle index. */
	paint?: PaintEntry[];
}
export interface BuildItem {
	objectId: string;
	transform: number[] | null;
}
export interface ModelScan {
	objects: Map<string, RawObject>;
	items: BuildItem[];
}

class Grow64 {
	a = new Float64Array(1024);
	n = 0;
	push(v: number) {
		if (this.n === this.a.length) {
			const b = new Float64Array(this.a.length * 2);
			b.set(this.a);
			this.a = b;
		}
		this.a[this.n++] = v;
	}
	done() {
		return this.a.slice(0, this.n);
	}
}
class Grow32 {
	a = new Uint32Array(1024);
	n = 0;
	push(v: number) {
		if (this.n === this.a.length) {
			const b = new Uint32Array(this.a.length * 2);
			b.set(this.a);
			this.a = b;
		}
		this.a[this.n++] = v;
	}
	done() {
		return this.a.slice(0, this.n);
	}
}

const TAG = /<(vertex|triangle|component|item|object|\/object)\b([^>]*)>/g;
const VERTEX = /x="([^"]*)"\s+y="([^"]*)"\s+z="([^"]*)"/;
const PAINT = /\bpaint_(supports|seam)="([^"]*)"/g;
const TRI = /v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/;

function attr(s: string, name: string): string | null {
	const m = new RegExp(`(?:^|[\\s:])${name}="([^"]*)"`).exec(s);
	return m ? m[1] : null;
}
function parseTransform(s: string | null): number[] | null {
	if (!s) return null;
	const n = s.trim().split(/\s+/).map(Number);
	return n.length === 12 && n.every(Number.isFinite) ? n : null;
}

/** Incremental scanner for a 3dmodel.model / object model text stream. */
export class ModelScanner {
	readonly scan: ModelScan = { objects: new Map(), items: [] };
	private decoder = new TextDecoder();
	private tail = '';
	private cur: {
		obj: RawObject;
		v: Grow64;
		t: Grow32;
		hasMesh: boolean;
		paint: PaintEntry[];
	} | null = null;
	bytes = 0;
	constructor(private readonly keepMeshes = true) {}

	push(chunk: Uint8Array, final: boolean) {
		this.bytes += chunk.length;
		let buf = this.tail + this.decoder.decode(chunk, { stream: !final });
		this.tail = '';
		if (!final) {
			const lt = buf.lastIndexOf('<');
			if (lt >= 0 && !buf.includes('>', lt)) {
				this.tail = buf.slice(lt);
				buf = buf.slice(0, lt);
			}
		}
		this.handle(buf);
		if (final && this.cur) this.closeObject();
	}

	private closeObject() {
		const c = this.cur!;
		if (c.hasMesh && this.keepMeshes) {
			c.obj.positions = c.v.done();
			c.obj.indices = c.t.done();
			if (c.paint.length) c.obj.paint = c.paint;
		}
		this.scan.objects.set(c.obj.id, c.obj);
		this.cur = null;
	}

	private handle(text: string) {
		TAG.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = TAG.exec(text))) {
			const kind = m[1];
			const rest = m[2];
			if (kind === 'vertex') {
				if (!this.cur || !this.keepMeshes) continue;
				const a = VERTEX.exec(rest);
				if (!a) continue;
				this.cur.hasMesh = true;
				this.cur.v.push(+a[1]);
				this.cur.v.push(+a[2]);
				this.cur.v.push(+a[3]);
			} else if (kind === 'triangle') {
				if (!this.cur || !this.keepMeshes) continue;
				if (rest.includes('paint_')) {
					PAINT.lastIndex = 0;
					let pm: RegExpExecArray | null;
					while ((pm = PAINT.exec(rest)))
						if (pm[2])
							this.cur.paint.push({
								kind: pm[1] as 'supports' | 'seam',
								tri: this.cur.t.n / 3,
								value: pm[2]
							});
				}
				const a = TRI.exec(rest);
				if (a) {
					this.cur.t.push(+a[1]);
					this.cur.t.push(+a[2]);
					this.cur.t.push(+a[3]);
				} else {
					const v1 = attr(rest, 'v1'),
						v2 = attr(rest, 'v2'),
						v3 = attr(rest, 'v3');
					if (v1 && v2 && v3) {
						this.cur.t.push(+v1);
						this.cur.t.push(+v2);
						this.cur.t.push(+v3);
					}
				}
			} else if (kind === 'component') {
				if (!this.cur) continue;
				const oid = attr(rest, 'objectid');
				if (!oid) continue;
				this.cur.obj.components.push({
					path: attr(rest, 'path'),
					objectId: oid,
					transform: parseTransform(attr(rest, 'transform'))
				});
			} else if (kind === 'item') {
				const oid = attr(rest, 'objectid');
				if (oid)
					this.scan.items.push({
						objectId: oid,
						transform: parseTransform(attr(rest, 'transform'))
					});
			} else if (kind === 'object') {
				if (this.cur) this.closeObject();
				const id = attr(rest, 'id');
				if (!id) continue;
				if (/\/\s*$/.test(rest)) {
					this.scan.objects.set(id, { id, components: [] });
					continue;
				}
				this.cur = {
					obj: { id, components: [] },
					v: new Grow64(),
					t: new Grow32(),
					hasMesh: false,
					paint: []
				};
			} else if (kind === '/object') {
				if (this.cur) this.closeObject();
			}
		}
	}
}

/** Streams selected zip entries (by exact name) to a callback; everything else is never inflated. */
export async function streamEntries(
	source: Source,
	want: (name: string) => ModelScanner | Uint8Array[] | null,
	onDone?: (name: string, data: ModelScanner | Uint8Array) => void,
	maxEntryBytes = 1 << 30
): Promise<void> {
	let failure: Error | null = null;
	const uz = new Unzip((file) => {
		if (failure) return;
		const sink = want(file.name);
		if (!sink) return;
		let size = 0;
		let dead = false;
		file.ondata = (err, chunk, final) => {
			if (dead) return;
			if (err) {
				failure ??= new Error(`Cannot read ${file.name}: ${err.message}`);
				dead = true;
				return;
			}
			size += chunk.length;
			if (size > maxEntryBytes) {
				dead = true;
				file.terminate();
				failure ??= new Error(`${file.name} is too large to read`);
				return;
			}
			if (sink instanceof ModelScanner) {
				sink.push(chunk, final);
				if (final) onDone?.(file.name, sink);
			} else {
				sink.push(chunk);
				if (final) {
					const buf = new Uint8Array(size);
					let o = 0;
					for (const c of sink) {
						buf.set(c, o);
						o += c.length;
					}
					onDone?.(file.name, buf);
				}
			}
		};
		file.start();
	});
	uz.register(UnzipInflate);
	uz.register(UnzipPassThrough);
	try {
		for await (const chunk of source as AsyncIterable<Uint8Array>) {
			uz.push(chunk);
			if (failure) break;
		}
		if (!failure) uz.push(new Uint8Array(0), true);
	} catch (e) {
		failure ??= new Error(
			`This does not look like a valid 3MF (zip) file: ${(e as Error).message}`
		);
	}
	if (failure) throw failure;
}

// ---- model_settings.config

const xml = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@',
	parseAttributeValue: false,
	parseTagValue: false,
	isArray: (n) => ['object', 'part', 'volume', 'plate', 'model_instance', 'metadata'].includes(n)
});
type XNode = Record<string, unknown>;
const asArr = <T>(v: T | T[] | undefined | null): T[] =>
	Array.isArray(v) ? v : v == null ? [] : [v];

export interface ObjectSettings {
	name: string;
	/** Every `<metadata key=... value=...>` of the object (wall_loops, sparse_infill_density, ...). */
	settings: Record<string, string>;
	/** Metadata of the object's parts (volumes) that carries slicer settings, merged; bookkeeping keys removed. */
	partSettings: Record<string, string>;
	/** Volume subtypes other than a normal part (modifiers, negative parts, supports). */
	extraSubtypes: string[];
}

/** Objects on each plate (`plater_id`), one entry per instance, in file order (Bambu/Orca `model_settings.config`). */
export function parsePlateInstances(bytes: Uint8Array): Map<number, string[]> {
	const doc = xml.parse(strFromU8(bytes)) as XNode;
	const out = new Map<number, string[]>();
	for (const p of asArr<XNode>(((doc.config ?? {}) as XNode).plate as XNode[])) {
		const meta: Record<string, string> = {};
		for (const m of asArr<XNode>(p.metadata as XNode[]))
			if (typeof m['@key'] === 'string') meta[m['@key']] = String(m['@value'] ?? '');
		const index = Number(meta.plater_id);
		if (!Number.isFinite(index)) continue;
		const ids: string[] = [];
		for (const mi of asArr<XNode>(p.model_instance as XNode[]))
			for (const m of asArr<XNode>(mi.metadata as XNode[]))
				if (m['@key'] === 'object_id') ids.push(String(m['@value']));
		out.set(index, ids);
	}
	return out;
}

/** Bed size in mm from `printable_area` of `project_settings.config` ("0x0", "256x0", ...). */
export function parseBedSize(bytes: Uint8Array): { x: number; y: number } | undefined {
	try {
		const ps = JSON.parse(strFromU8(bytes)) as { printable_area?: unknown };
		const area = Array.isArray(ps.printable_area) ? ps.printable_area : [];
		const xs: number[] = [];
		const ys: number[] = [];
		for (const a of area) {
			const m = /^\s*(-?[\d.]+)\s*x\s*(-?[\d.]+)\s*$/.exec(String(a));
			if (m) {
				xs.push(+m[1]);
				ys.push(+m[2]);
			}
		}
		if (xs.length < 3) return undefined;
		const x = Math.max(...xs) - Math.min(...xs);
		const y = Math.max(...ys) - Math.min(...ys);
		return x > 0 && y > 0 ? { x: round1(x), y: round1(y) } : undefined;
	} catch {
		return undefined;
	}
}

export function parseModelSettings(bytes: Uint8Array): Map<string, ObjectSettings> {
	const doc = xml.parse(strFromU8(bytes)) as XNode;
	const out = new Map<string, ObjectSettings>();
	for (const o of asArr<XNode>(((doc.config ?? {}) as XNode).object as XNode[])) {
		const settings: Record<string, string> = {};
		for (const m of asArr<XNode>(o.metadata as XNode[])) {
			const k = m['@key'];
			if (typeof k === 'string') settings[k] = decodeEntities(String(m['@value'] ?? ''));
		}
		const partSettings: Record<string, string> = {};
		for (const p of asArr<XNode>((o.part ?? o.volume) as XNode[]))
			for (const m of asArr<XNode>(p.metadata as XNode[])) {
				const k = m['@key'];
				if (
					typeof k === 'string' &&
					!/^(name|matrix|extruder|source_.*|volume_type|face_count)$/.test(k)
				)
					partSettings[k] = decodeEntities(String(m['@value'] ?? ''));
			}
		const subs = asArr<XNode>((o.part ?? o.volume) as XNode[])
			.map((p) => String(p['@subtype'] ?? 'normal_part'))
			.filter((s) => s !== 'normal_part');
		let partName = '';
		for (const m of asArr<XNode>(
			(asArr<XNode>((o.part ?? o.volume) as XNode[])[0]?.metadata ?? []) as XNode[]
		))
			if (m['@key'] === 'name') partName = decodeEntities(String(m['@value'] ?? ''));
		const name = settings.name || partName || `Object ${o['@id']}`;
		delete settings.name;
		out.set(String(o['@id']), { name, settings, partSettings, extraSubtypes: subs });
	}
	return out;
}

// ---- structure pass

export interface Structure {
	model: ModelScan;
	objects: Map<string, ObjectSettings>;
	/** Object ids per plate number, one per instance (project files only). */
	plates: Map<number, string[]>;
	/** Bed size of the file's printer profile, when it says. */
	bed?: { x: number; y: number };
	warnings: string[];
}

export async function readStructure(open: SourceFactory): Promise<Structure> {
	const model = new ModelScanner(true);
	let ms: Uint8Array | null = null;
	let ps: Uint8Array | null = null;
	await streamEntries(
		open(),
		(name) => {
			if (name === '3D/3dmodel.model') return model;
			if (name === 'Metadata/model_settings.config') return [];
			if (name === 'Metadata/project_settings.config') return [];
			return null;
		},
		(name, data) => {
			if (name === 'Metadata/model_settings.config') ms = data as Uint8Array;
			if (name === 'Metadata/project_settings.config') ps = data as Uint8Array;
		}
	);
	const bed = ps ? parseBedSize(ps) : undefined;
	return {
		model: model.scan,
		objects: ms ? parseModelSettings(ms) : new Map(),
		plates: ms ? parsePlateInstances(ms) : new Map(),
		...(bed ? { bed } : {}),
		warnings: []
	};
}

// ---- geometry

export interface ExtractRequest {
	/** Build item / model_settings object id. */
	objectId: string;
	/**
	 * Further build items that show the same geometry (copies on a plate). Their placement
	 * relative to this object is measured (`Geometry.placements`); their meshes are not kept.
	 */
	copies?: InstanceRef[];
}

/** One build item: object id plus which of that object's items (0-based, in file order). */
export interface InstanceRef {
	objectId: string;
	index: number;
}

/**
 * Where a copy of the stored (normalised) mesh sits in the file's own coordinates: the stored
 * mesh point p goes to `Rz(rot) * p + (x, y)`. `ok` is false when the copy is not the same
 * shape turned flat about z (different mesh, mirrored or tilted).
 */
export interface Placement extends InstanceRef {
	x: number;
	y: number;
	/** Degrees counter-clockwise, 0..360. */
	rot: number;
	ok: boolean;
}

export interface Geometry {
	objectId: string;
	/** Float32 xyz, z up, lowest vertex z = 0, XY box centre at the origin, turned by `angleDeg`. */
	positions: Float32Array;
	indices: Uint32Array;
	w: number;
	d: number;
	h: number;
	/** Box size before the min-area turn (as MakeGood placed it). */
	placedW: number;
	placedD: number;
	/** Counter-clockwise turn about z that was baked in, degrees. */
	angleDeg: number;
	hull: Pt[];
	tris: number;
	/** Slicer paint per triangle (kept verbatim; triangle order is unchanged). */
	paint?: PaintEntry[];
	/** The object itself (index 0) and each requested copy in the file's coordinates; only with `copies`. */
	placements?: Placement[];
}

const norm = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);

function apply(t: number[] | null, x: number, y: number, z: number): [number, number, number] {
	if (!t) return [x, y, z];
	return [
		x * t[0] + y * t[3] + z * t[6] + t[9],
		x * t[1] + y * t[4] + z * t[7] + t[10],
		x * t[2] + y * t[5] + z * t[8] + t[11]
	];
}
const det3 = (t: number[] | null) =>
	!t
		? 1
		: t[0] * (t[4] * t[8] - t[5] * t[7]) -
			t[1] * (t[3] * t[8] - t[5] * t[6]) +
			t[2] * (t[3] * t[7] - t[4] * t[6]);

/** Combine meshes of an item's components (item transform last). */
function worldMesh(
	obj: RawObject,
	item: BuildItem,
	meshOf: (
		c: Component
	) => { positions: Float64Array; indices: Uint32Array; paint?: PaintEntry[] } | null
): { pos: Float64Array; idx: Uint32Array; paint: PaintEntry[]; paintDropped: number } | null {
	const parts: { pos: Float64Array; idx: Uint32Array; paint: PaintEntry[] }[] = [];
	let paintDropped = 0;
	const add = (
		m: { positions: Float64Array; indices: Uint32Array; paint?: PaintEntry[] },
		ct: number[] | null
	) => {
		const pos = new Float64Array(m.positions.length);
		for (let i = 0; i < m.positions.length; i += 3) {
			const [x, y, z] = apply(
				item.transform,
				...apply(ct, m.positions[i], m.positions[i + 1], m.positions[i + 2])
			);
			pos[i] = x;
			pos[i + 1] = y;
			pos[i + 2] = z;
		}
		// a mirroring transform flips the winding
		const flip = det3(item.transform) * det3(ct) < 0;
		const idx = new Uint32Array(m.indices);
		if (flip)
			for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
		// Paint is tied to each triangle's vertex order; a mirrored mesh would need it mirrored too, so it is dropped.
		if (flip) paintDropped += m.paint?.length ?? 0;
		parts.push({ pos, idx, paint: flip ? [] : (m.paint ?? []) });
	};
	if (obj.positions && obj.indices)
		add({ positions: obj.positions, indices: obj.indices, paint: obj.paint }, null);
	for (const c of obj.components) {
		const m = meshOf(c);
		if (m) add(m, c.transform);
	}
	if (!parts.length) return null;
	const nv = parts.reduce((a, p) => a + p.pos.length, 0);
	const ni = parts.reduce((a, p) => a + p.idx.length, 0);
	const pos = new Float64Array(nv);
	const idx = new Uint32Array(ni);
	const paint: PaintEntry[] = [];
	let vo = 0,
		io = 0;
	for (const p of parts) {
		for (const e of p.paint) paint.push({ ...e, tri: e.tri + io / 3 });
		pos.set(p.pos, vo);
		for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo / 3;
		vo += p.pos.length;
		io += p.idx.length;
	}
	return { pos, idx, paint, paintDropped };
}

/**
 * The flat motion (turn about z by phi, then move by (tx, ty)) that takes the xy of mesh `a` onto
 * mesh `b`, when they are the same vertices in the same order (copies of one object) and z agrees.
 * Null when the shapes differ by more than `tol` mm anywhere.
 */
export function alignFlat(
	a: Float64Array,
	b: Float64Array,
	tol = 0.05
): { phi: number; tx: number; ty: number } | null {
	if (a.length !== b.length || a.length < 9) return null;
	const n = a.length / 3;
	let ax = 0,
		ay = 0,
		bx = 0,
		by = 0;
	for (let i = 0; i < n; i++) {
		ax += a[i * 3];
		ay += a[i * 3 + 1];
		bx += b[i * 3];
		by += b[i * 3 + 1];
	}
	ax /= n;
	ay /= n;
	bx /= n;
	by /= n;
	let sc = 0,
		ss = 0;
	for (let i = 0; i < n; i++) {
		const x = a[i * 3] - ax;
		const y = a[i * 3 + 1] - ay;
		const u = b[i * 3] - bx;
		const v = b[i * 3 + 1] - by;
		sc += x * u + y * v;
		ss += x * v - y * u;
	}
	const phi = Math.atan2(ss, sc);
	const c = Math.cos(phi);
	const s = Math.sin(phi);
	const tx = bx - (c * ax - s * ay);
	const ty = by - (s * ax + c * ay);
	let dz = 0;
	let za = Infinity;
	let zb = Infinity;
	for (let i = 0; i < n; i++) {
		za = Math.min(za, a[i * 3 + 2]);
		zb = Math.min(zb, b[i * 3 + 2]);
	}
	for (let i = 0; i < n; i++) {
		const x = c * a[i * 3] - s * a[i * 3 + 1] + tx - b[i * 3];
		const y = s * a[i * 3] + c * a[i * 3 + 1] + ty - b[i * 3 + 1];
		if (Math.hypot(x, y) > tol) return null;
		dz = Math.max(dz, Math.abs(a[i * 3 + 2] - za - (b[i * 3 + 2] - zb)));
	}
	return dz > tol ? null : { phi, tx, ty };
}

/** Drop to z = 0, turn to the minimum-area box about z and centre; compute footprint and hull. */
export function normalizeMesh(
	pos: Float64Array,
	idx: Uint32Array,
	objectId: string
): Geometry & { turn: { ang: number; cx: number; cy: number } } {
	const n = pos.length / 3;
	let minZ = Infinity,
		maxZ = -Infinity;
	const pts: Pt[] = new Array(n);
	for (let i = 0; i < n; i++) {
		pts[i] = [pos[i * 3], pos[i * 3 + 1]];
		const z = pos[i * 3 + 2];
		if (z < minZ) minZ = z;
		if (z > maxZ) maxZ = z;
	}
	const hull0 = convexHull(pts);
	const placed = bounds(hull0);
	const ang = minAreaAngle(hull0);
	const c = Math.cos(ang);
	const s = Math.sin(ang);
	const rotated = rotatePoints(hull0, ang);
	const rb = bounds(rotated);
	const cx = (rb.minX + rb.maxX) / 2;
	const cy = (rb.minY + rb.maxY) / 2;
	const positions = new Float32Array(pos.length);
	for (let i = 0; i < n; i++) {
		const x = pos[i * 3];
		const y = pos[i * 3 + 1];
		positions[i * 3] = norm(x * c - y * s - cx);
		positions[i * 3 + 1] = norm(x * s + y * c - cy);
		positions[i * 3 + 2] = norm(pos[i * 3 + 2] - minZ);
	}
	const hull = simplifyHull(
		rotated.map(([x, y]) => [x - cx, y - cy] as Pt),
		24
	).map(([x, y]) => [round1(x), round1(y)] as Pt);
	return {
		objectId,
		positions,
		indices: idx,
		w: Math.ceil(rb.w * 10) / 10,
		d: Math.ceil(rb.d * 10) / 10,
		h: Math.ceil((maxZ - minZ) * 10) / 10,
		placedW: Math.ceil(placed.w * 10) / 10,
		placedD: Math.ceil(placed.d * 10) / 10,
		angleDeg: Math.round(((ang * 180) / Math.PI) * 10) / 10,
		hull,
		tris: idx.length / 3,
		turn: { ang, cx, cy }
	};
}

/**
 * Extract the geometry of the requested build objects (by object id). Object files
 * that no request needs are never inflated. Returns a map objectId -> geometry.
 */
export async function extractGeometry(
	open: SourceFactory,
	structure: Structure,
	requests: ExtractRequest[],
	onProgress?: (done: number, total: number) => void
): Promise<{ geometry: Map<string, Geometry>; warnings: string[] }> {
	const warnings: string[] = [];
	const { model } = structure;
	const itemsOf = new Map<string, BuildItem[]>();
	for (const i of model.items) itemsOf.set(i.objectId, [...(itemsOf.get(i.objectId) ?? []), i]);
	const itemFor = (ref: InstanceRef) => itemsOf.get(ref.objectId)?.[ref.index];
	const need = new Map<string, string[]>(); // path -> object ids
	const todo: { req: ExtractRequest; obj: RawObject; item: BuildItem }[] = [];
	const wantPaths = (objectId: string) => {
		for (const c of model.objects.get(objectId)?.components ?? [])
			if (c.path) {
				const p = c.path.replace(/^\//, '');
				need.set(p, [...(need.get(p) ?? []), objectId]);
			}
	};
	for (const r of requests) {
		const obj = model.objects.get(r.objectId);
		const item = itemFor({ objectId: r.objectId, index: 0 });
		if (!obj || !item) {
			warnings.push(`Object ${r.objectId} has no build item; skipped`);
			continue;
		}
		todo.push({ req: r, obj, item });
		wantPaths(r.objectId);
		for (const c of r.copies ?? []) wantPaths(c.objectId);
	}
	const files = new Map<string, Map<string, RawObject>>(); // path -> objects
	if (need.size) {
		let done = 0;
		await streamEntries(
			open(),
			(name) => (need.has(name) ? new ModelScanner(true) : null),
			(name, data) => {
				files.set(name, (data as ModelScanner).scan.objects);
				onProgress?.(++done, need.size);
			}
		);
	}
	const geometry = new Map<string, Geometry>();
	const meshOf = (c: Component) => {
		const objs = c.path ? files.get(c.path.replace(/^\//, '')) : model.objects;
		const o = objs?.get(c.objectId);
		return o?.positions && o.indices
			? { positions: o.positions, indices: o.indices, paint: o.paint }
			: null;
	};
	for (const { req, obj, item } of todo) {
		const m = worldMesh(obj, item, meshOf);
		if (!m || m.pos.length < 9) {
			warnings.push(`Object ${req.objectId} has no readable mesh; skipped`);
			continue;
		}
		const { turn, ...g } = normalizeMesh(m.pos, m.idx, req.objectId);
		if (m.paint.length) g.paint = m.paint;
		if (req.copies) {
			// the stored mesh p is the file's xy turned by `ang` and moved by -c: world = R(-ang) (p + c)
			const rot0 = -turn.ang;
			const c0 = Math.cos(rot0);
			const s0 = Math.sin(rot0);
			const px = c0 * turn.cx - s0 * turn.cy;
			const py = s0 * turn.cx + c0 * turn.cy;
			const deg = (r: number) => ((((r * 180) / Math.PI) % 360) + 360) % 360;
			g.placements = [{ objectId: req.objectId, index: 0, x: px, y: py, rot: deg(rot0), ok: true }];
			for (const ref of req.copies) {
				const o2 = model.objects.get(ref.objectId);
				const it2 = itemFor(ref);
				const m2 = o2 && it2 ? worldMesh(o2, it2, meshOf) : null;
				const rel = m2 ? alignFlat(m.pos, m2.pos) : null;
				if (!rel) {
					g.placements.push({ ...ref, x: 0, y: 0, rot: 0, ok: false });
					continue;
				}
				// world2 = R(phi) world + t, so p goes to R(phi - ang) p + R(phi) (R(-ang) c) + t
				const cp = Math.cos(rel.phi);
				const sp = Math.sin(rel.phi);
				g.placements.push({
					...ref,
					x: cp * px - sp * py + rel.tx,
					y: sp * px + cp * py + rel.ty,
					rot: deg(rot0 + rel.phi),
					ok: true
				});
			}
		}
		if (m.paintDropped)
			warnings.push(
				`Object ${req.objectId}: ${m.paintDropped} painted triangles were dropped because the object is mirrored in the profile`
			);
		geometry.set(req.objectId, g);
	}
	return { geometry, warnings };
}
