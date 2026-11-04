/**
 * Kit pack format (`tmt-kitpack-1`): a zip (`.kitpack`) holding the converted files of one
 * template, so a fresh install has the standard kit without uploading anything. See
 * `docs/kit-pack.md`. Pure functions only (no database, no disk), shared by the builder and
 * the installer.
 */
import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import type { PaintEntry, PrintMesh } from '../print-geometry/mesh-format';

export const PACK_FORMAT = 'tmt-kitpack-1';
export const INDEX_FORMAT = 'tmt-kitpack-index-1';
export const MANIFEST_FILE = 'manifest.json';
export const PLACEMENTS_FILE = 'placements.json';
export const GEOMETRY_FILE = 'print/geometry.json';
export const MODEL_FILE = 'model/model.glb';
export const MODEL_INFO_FILE = 'model/model.json';
export const HARDWARE_FILE = 'model/hardware.glb';
export const CREDITS_FILE = 'CREDITS.md';
export const MESH_DIR = 'print/meshes/';

export type SourceRole =
	'model' | 'model-info' | 'hardware' | 'placements' | 'geometry' | 'mesh' | 'credits';
const ROLES: SourceRole[] = [
	'model',
	'model-info',
	'hardware',
	'placements',
	'geometry',
	'mesh',
	'credits'
];

export interface PackSource {
	file: string;
	sha256: string;
	role: SourceRole;
}

export interface PackManifest {
	format: typeof PACK_FORMAT;
	templateSlug: string;
	version: string;
	createdAt: string;
	sources: PackSource[];
	license: { name: string; holder: string; url?: string; note: string };
	contents: {
		parts: number;
		meshes: number;
		triangles: number;
		paintedFaces: number;
		placements: number;
		placed: number;
		hardware: boolean;
	};
	appMinVersion: string;
}

export interface IndexEntry {
	slug: string;
	version: string;
	file: string;
	sha256: string;
	size: number;
}
export interface PackIndex {
	format: typeof INDEX_FORMAT;
	packs: IndexEntry[];
}

export class KitPackError extends Error {}

export const sha256Hex = (bytes: Uint8Array | Buffer): string =>
	createHash('sha256').update(bytes).digest('hex');

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA = /^[0-9a-f]{64}$/;
const VERSION = /^[0-9]+(\.[0-9]+){0,3}$/;

/** Entry names in a pack: relative, no `..`, no leading slash. */
export function isSafePackPath(p: string): boolean {
	return SAFE_PATH.test(p) && !p.split('/').some((s) => s === '..' || s === '' || s === '.');
}

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Compare dotted numeric versions ("1.2.0" vs "1.10"); missing segments count as 0. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
	const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d < 0 ? -1 : 1;
	}
	return 0;
}

/** Validates a parsed manifest.json; throws KitPackError naming the problem. */
export function parseManifest(raw: unknown): PackManifest {
	if (!isObj(raw)) throw new KitPackError('manifest.json is not an object');
	if (raw.format !== PACK_FORMAT)
		throw new KitPackError(`Unsupported kit pack format: ${String(raw.format)}`);
	const str = (k: string, re?: RegExp) => {
		const v = raw[k];
		if (typeof v !== 'string' || !v || (re && !re.test(v)))
			throw new KitPackError(`manifest.${k} is missing or invalid`);
		return v;
	};
	const templateSlug = str('templateSlug', SAFE_NAME);
	const version = str('version', VERSION);
	const createdAt = str('createdAt');
	if (Number.isNaN(Date.parse(createdAt))) throw new KitPackError('manifest.createdAt is invalid');
	const appMinVersion = str('appMinVersion', VERSION);
	if (!Array.isArray(raw.sources) || !raw.sources.length)
		throw new KitPackError('manifest.sources is empty');
	const seen = new Set<string>();
	const sources = raw.sources.map((s, i): PackSource => {
		if (
			!isObj(s) ||
			typeof s.file !== 'string' ||
			!isSafePackPath(s.file) ||
			typeof s.sha256 !== 'string' ||
			!SHA.test(s.sha256) ||
			!ROLES.includes(s.role as SourceRole)
		)
			throw new KitPackError(`manifest.sources[${i}] is invalid`);
		if (seen.has(s.file)) throw new KitPackError(`manifest.sources lists ${s.file} twice`);
		seen.add(s.file);
		return { file: s.file, sha256: s.sha256, role: s.role as SourceRole };
	});
	const lic = raw.license;
	if (
		!isObj(lic) ||
		typeof lic.name !== 'string' ||
		typeof lic.holder !== 'string' ||
		typeof lic.note !== 'string' ||
		(lic.url !== undefined && typeof lic.url !== 'string')
	)
		throw new KitPackError('manifest.license is invalid');
	const c = raw.contents;
	if (!isObj(c)) throw new KitPackError('manifest.contents is missing');
	for (const k of ['parts', 'meshes', 'triangles', 'paintedFaces', 'placements', 'placed'])
		if (typeof c[k] !== 'number' || !Number.isFinite(c[k]))
			throw new KitPackError(`manifest.contents.${k} is invalid`);
	if (typeof c.hardware !== 'boolean') throw new KitPackError('manifest.contents.hardware invalid');
	for (const role of ['model', 'placements', 'geometry'] as const)
		if (!sources.some((s) => s.role === role))
			throw new KitPackError(`manifest.sources has no ${role} file`);
	return {
		format: PACK_FORMAT,
		templateSlug,
		version,
		createdAt,
		sources,
		license: {
			name: lic.name,
			holder: lic.holder,
			note: lic.note,
			...(lic.url ? { url: lic.url as string } : {})
		},
		contents: c as unknown as PackManifest['contents'],
		appMinVersion
	};
}

/** Validates the committed `kitpacks/index.json`. */
export function parseIndex(raw: unknown): PackIndex {
	if (!isObj(raw) || raw.format !== INDEX_FORMAT || !Array.isArray(raw.packs))
		throw new KitPackError('kitpacks/index.json is not a kit pack index');
	const packs = raw.packs.map((p, i): IndexEntry => {
		if (
			!isObj(p) ||
			typeof p.slug !== 'string' ||
			!SAFE_NAME.test(p.slug) ||
			typeof p.version !== 'string' ||
			!VERSION.test(p.version) ||
			typeof p.file !== 'string' ||
			!SAFE_NAME.test(p.file) ||
			typeof p.sha256 !== 'string' ||
			!SHA.test(p.sha256) ||
			typeof p.size !== 'number' ||
			!(p.size > 0)
		)
			throw new KitPackError(`kitpacks/index.json packs[${i}] is invalid`);
		return { slug: p.slug, version: p.version, file: p.file, sha256: p.sha256, size: p.size };
	});
	return { format: INDEX_FORMAT, packs };
}

// ---- Quantized mesh ("TMTQ")

/**
 * Pack-side mesh: positions rounded to 1/`scale` mm as int32, delta coded (per axis, against the
 * previous vertex, vertices renumbered in order of first use) and written as zigzag varints;
 * indices coded as fresh vertex (0), place in a 64-entry move-to-front list, or distance from the newest; paint entries kept verbatim (kind, delta of triangle index,
 * ASCII string). Zip deflate does the rest. Layout, little endian:
 *
 *   "TMTQ"  u8 version(1)  u32 scale  u32 V  u32 T  u32 P  then varint streams:
 *   x deltas (V), y deltas (V), z deltas (V), index codes (3T), paint (P times: u8 kind,
 *   varint tri delta, varint length, bytes)
 */
export const QMESH_MAGIC = 'TMTQ';
export const DEFAULT_SCALE = 100;
const MRU = 64;

/** Pack entry name of a piece's mesh (`<mesh file without .bin>.qmesh.br`: brotli of the quantized mesh). */
export const meshEntryName = (meshFile: string) =>
	`${MESH_DIR}${meshFile.replace(/\.bin$/, '')}.qmesh.br`;

/** Brotli (quality 11, 16 MB window) of a quantized mesh: ~20% smaller than zip's deflate on these. */
export function packMesh(q: Uint8Array): Uint8Array {
	return brotliCompressSync(q, {
		params: {
			[constants.BROTLI_PARAM_QUALITY]: 11,
			[constants.BROTLI_PARAM_LGWIN]: 24,
			[constants.BROTLI_PARAM_SIZE_HINT]: q.length
		}
	});
}
const MAX_MESH_BYTES = 256 * 1024 * 1024;
export function unpackMesh(b: Uint8Array): Uint8Array {
	try {
		return brotliDecompressSync(b, { maxOutputLength: MAX_MESH_BYTES });
	} catch {
		throw new KitPackError('Corrupt compressed mesh');
	}
}

class Writer {
	buf = new Uint8Array(1 << 16);
	n = 0;
	private ensure(k: number) {
		if (this.n + k <= this.buf.length) return;
		let len = this.buf.length * 2;
		while (len < this.n + k) len *= 2;
		const b = new Uint8Array(len);
		b.set(this.buf);
		this.buf = b;
	}
	byte(v: number) {
		this.ensure(1);
		this.buf[this.n++] = v;
	}
	u32(v: number) {
		this.ensure(4);
		new DataView(this.buf.buffer).setUint32(this.n, v, true);
		this.n += 4;
	}
	/** Unsigned varint (values below 2^53). */
	varint(v: number) {
		this.ensure(10);
		while (v >= 0x80) {
			this.buf[this.n++] = (v % 0x80) | 0x80;
			v = Math.floor(v / 0x80);
		}
		this.buf[this.n++] = v;
	}
	zigzag(v: number) {
		this.varint(v >= 0 ? v * 2 : -v * 2 - 1);
	}
	bytes(b: Uint8Array) {
		this.ensure(b.length);
		this.buf.set(b, this.n);
		this.n += b.length;
	}
	done() {
		return this.buf.slice(0, this.n);
	}
}

class Reader {
	n = 0;
	constructor(
		readonly buf: Uint8Array,
		private dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
	) {}
	byte(): number {
		if (this.n >= this.buf.length) throw new KitPackError('Truncated mesh');
		return this.buf[this.n++];
	}
	u32(): number {
		if (this.n + 4 > this.buf.length) throw new KitPackError('Truncated mesh');
		const v = this.dv.getUint32(this.n, true);
		this.n += 4;
		return v;
	}
	varint(): number {
		let v = 0;
		let mul = 1;
		for (;;) {
			const b = this.byte();
			v += (b & 0x7f) * mul;
			if (b < 0x80) return v;
			mul *= 0x80;
			if (mul > 2 ** 56) throw new KitPackError('Bad varint');
		}
	}
	zigzag(): number {
		const v = this.varint();
		return v % 2 ? -(v + 1) / 2 : v / 2;
	}
	bytes(len: number): Uint8Array {
		if (this.n + len > this.buf.length) throw new KitPackError('Truncated mesh');
		const out = this.buf.subarray(this.n, this.n + len);
		this.n += len;
		return out;
	}
}

/** Largest position error `encodeQMesh` can introduce for a given scale (half a step, mm). */
export const quantError = (scale: number) => 0.5 / scale;

export function encodeQMesh(m: PrintMesh, scale = DEFAULT_SCALE, renumber = true): Uint8Array {
	const V = m.positions.length / 3;
	const T = m.indices.length / 3;
	const paint = m.paint ?? [];
	const w = new Writer();
	for (let i = 0; i < 4; i++) w.byte(QMESH_MAGIC.charCodeAt(i));
	w.byte(1);
	w.u32(scale);
	w.u32(V);
	w.u32(T);
	w.u32(paint.length);
	// Vertices are renumbered in order of first use (unused ones last): same triangles, far
	// smaller codes. The decoded mesh has the same triangles in the same order, so paint is unaffected.
	const remap = new Int32Array(V).fill(-1);
	const order: number[] = [];
	if (!renumber)
		for (let i = 0; i < V; i++) {
			remap[i] = i;
			order.push(i);
		}
	for (let i = 0; i < m.indices.length; i++) {
		const idx = m.indices[i];
		if (idx >= V) throw new KitPackError('Mesh index out of range');
		if (remap[idx] < 0) {
			remap[idx] = order.length;
			order.push(idx);
		}
	}
	for (let i = 0; i < V; i++)
		if (remap[i] < 0) {
			remap[i] = order.length;
			order.push(i);
		}
	for (let axis = 0; axis < 3; axis++) {
		let prev = 0;
		for (let k = 0; k < V; k++) {
			const q = Math.round(m.positions[order[k] * 3 + axis] * scale);
			if (!Number.isFinite(q) || Math.abs(q) > 2 ** 31 - 1)
				throw new KitPackError('Mesh coordinate out of range');
			w.zigzag(q - prev);
			prev = q;
		}
	}
	// Index codes: 0 = the next fresh vertex, 1..MRU = place in a move-to-front list of recently
	// used vertices, MRU+1+k = k places below the newest vertex (anything else).
	let next = 0; // lowest vertex index not seen yet
	const mru: number[] = [];
	for (let i = 0; i < m.indices.length; i++) {
		const idx = remap[m.indices[i]];
		if (idx >= next) {
			w.varint(0);
			next = idx + 1;
		} else {
			const p = mru.indexOf(idx);
			if (p >= 0) {
				w.varint(1 + p);
				mru.splice(p, 1);
			} else w.varint(MRU + 1 + (next - 1 - idx));
		}
		mru.unshift(idx);
		if (mru.length > MRU) mru.pop();
	}
	let prevTri = 0;
	for (const p of paint) {
		const s = new TextEncoder().encode(p.value);
		w.byte(p.kind === 'supports' ? 1 : 2);
		w.zigzag(p.tri - prevTri);
		prevTri = p.tri;
		w.varint(s.length);
		w.bytes(s);
	}
	return w.done();
}

export function decodeQMesh(bytes: Uint8Array): PrintMesh {
	const r = new Reader(bytes);
	for (let i = 0; i < 4; i++)
		if (r.byte() !== QMESH_MAGIC.charCodeAt(i)) throw new KitPackError('Not a quantized mesh');
	if (r.byte() !== 1) throw new KitPackError('Unsupported quantized mesh version');
	const scale = r.u32();
	const V = r.u32();
	const T = r.u32();
	const P = r.u32();
	if (!scale || V > 1 << 26 || T > 1 << 26 || P > T * 2 + 1)
		throw new KitPackError('Bad mesh header');
	const positions = new Float32Array(V * 3);
	for (let axis = 0; axis < 3; axis++) {
		let prev = 0;
		for (let i = 0; i < V; i++) {
			prev += r.zigzag();
			positions[i * 3 + axis] = prev / scale;
		}
	}
	const indices = new Uint32Array(T * 3);
	let next = 0;
	const mru: number[] = [];
	for (let i = 0; i < indices.length; i++) {
		const code = r.varint();
		let idx: number;
		if (code === 0) idx = next++;
		else if (code <= MRU) {
			if (code > mru.length) throw new KitPackError('Bad mesh index code');
			idx = mru[code - 1];
			mru.splice(code - 1, 1);
		} else idx = next - 1 - (code - MRU - 1);
		if (idx < 0 || idx >= next) throw new KitPackError('Mesh index out of range');
		indices[i] = idx;
		mru.unshift(idx);
		if (mru.length > MRU) mru.pop();
	}
	const paint: PaintEntry[] = [];
	let prevTri = 0;
	for (let i = 0; i < P; i++) {
		const kind = r.byte();
		if (kind !== 1 && kind !== 2) throw new KitPackError('Bad paint kind');
		prevTri += r.zigzag();
		const len = r.varint();
		paint.push({
			kind: kind === 1 ? 'supports' : 'seam',
			tri: prevTri,
			value: new TextDecoder().decode(r.bytes(len))
		});
	}
	return { positions, indices, ...(paint.length ? { paint } : {}) };
}
