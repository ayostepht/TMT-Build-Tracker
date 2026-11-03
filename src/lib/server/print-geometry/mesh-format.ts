/**
 * Compact binary mesh used for print-orientation part geometry
 * (`uploadsDir()/print/<templateId>/<slug>[__n].bin`).
 *
 * Little endian:
 *
 *   offset 0   char[4]  "TMTP"
 *   offset 4   uint32   version (1, or 2 when per-triangle paint follows)
 *   offset 8   uint32   vertex count V
 *   offset 12  uint32   triangle count T
 *   offset 16  float32  positions, V * 3 (x, y, z in mm)
 *   then       uint32   indices, T * 3 (counter-clockwise seen from outside)
 *   version 2 only:
 *              uint32   paint entry count P
 *              P times: uint8 kind (1 = supports, 2 = seam), uint32 triangle index,
 *                       uint16 byte length L, L bytes of the slicer's paint string (ASCII)
 *
 * Frame: z up, the lowest vertex at z = 0, the centre of the XY bounding box at
 * (0, 0). The mesh is already turned about z to its minimum-area box, so a placed item only
 * needs `rotate(rotation about z)` then `translate(x, y)` from `ArrangedItem`.
 * Version 1 files (imported before paint was kept) stay readable; they have no paint.
 */
export const MESH_MAGIC = 'TMTP';
export const MESH_VERSION = 1;
export const MESH_VERSION_PAINT = 2;

export type PaintKind = 'supports' | 'seam';
/** Slicer paint of one triangle (Bambu/Orca `paint_supports`, `paint_seam` attributes), kept verbatim. */
export interface PaintEntry {
	kind: PaintKind;
	tri: number;
	value: string;
}

export interface PrintMesh {
	positions: Float32Array;
	indices: Uint32Array;
	/** Per-triangle paint (sparse, sorted by kind then triangle). Absent: none. */
	paint?: PaintEntry[];
}

const KIND_CODE: Record<PaintKind, number> = { supports: 1, seam: 2 };
const KIND_NAME: Record<number, PaintKind> = { 1: 'supports', 2: 'seam' };

export function encodeMesh(m: PrintMesh): Uint8Array {
	const v = m.positions.length / 3;
	const t = m.indices.length / 3;
	const paint = (m.paint ?? []).filter((p) => /^[\x20-\x7e]{1,65535}$/.test(p.value));
	const strings = paint.map((p) => new TextEncoder().encode(p.value));
	const paintBytes = paint.length
		? 4 + paint.reduce((a, _, i) => a + 1 + 4 + 2 + strings[i].length, 0)
		: 0;
	const out = new Uint8Array(16 + m.positions.byteLength + m.indices.byteLength + paintBytes);
	const dv = new DataView(out.buffer);
	for (let i = 0; i < 4; i++) out[i] = MESH_MAGIC.charCodeAt(i);
	dv.setUint32(4, paint.length ? MESH_VERSION_PAINT : MESH_VERSION, true);
	dv.setUint32(8, v, true);
	dv.setUint32(12, t, true);
	// DataView keeps this endian-correct on any host
	let o = 16;
	for (let i = 0; i < m.positions.length; i++, o += 4) dv.setFloat32(o, m.positions[i], true);
	for (let i = 0; i < m.indices.length; i++, o += 4) dv.setUint32(o, m.indices[i], true);
	if (paint.length) {
		dv.setUint32(o, paint.length, true);
		o += 4;
		paint.forEach((p, i) => {
			out[o++] = KIND_CODE[p.kind];
			dv.setUint32(o, p.tri, true);
			o += 4;
			dv.setUint16(o, strings[i].length, true);
			o += 2;
			out.set(strings[i], o);
			o += strings[i].length;
		});
	}
	return out;
}

export function decodeMesh(bytes: Uint8Array): PrintMesh {
	if (bytes.length < 16) throw new Error('Mesh file too short');
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
	if (magic !== MESH_MAGIC) throw new Error('Not a TMTP mesh');
	const version = dv.getUint32(4, true);
	if (version !== MESH_VERSION && version !== MESH_VERSION_PAINT)
		throw new Error('Unsupported mesh version');
	const v = dv.getUint32(8, true);
	const t = dv.getUint32(12, true);
	if (bytes.length < 16 + v * 12 + t * 12) throw new Error('Mesh file truncated');
	const positions = new Float32Array(v * 3);
	const indices = new Uint32Array(t * 3);
	let o = 16;
	for (let i = 0; i < positions.length; i++, o += 4) positions[i] = dv.getFloat32(o, true);
	for (let i = 0; i < indices.length; i++, o += 4) indices[i] = dv.getUint32(o, true);
	if (version === MESH_VERSION_PAINT) {
		const n = dv.getUint32(o, true);
		o += 4;
		const paint: PaintEntry[] = [];
		const dec = new TextDecoder();
		for (let i = 0; i < n; i++) {
			if (o + 7 > bytes.length) throw new Error('Mesh file truncated');
			const kind = KIND_NAME[bytes[o++]];
			const tri = dv.getUint32(o, true);
			o += 4;
			const len = dv.getUint16(o, true);
			o += 2;
			if (o + len > bytes.length) throw new Error('Mesh file truncated');
			if (kind) paint.push({ kind, tri, value: dec.decode(bytes.subarray(o, o + len)) });
			o += len;
		}
		return { positions, indices, paint };
	}
	return { positions, indices };
}
