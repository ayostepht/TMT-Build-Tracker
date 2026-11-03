/**
 * Compact binary mesh used for print-orientation part geometry
 * (`uploadsDir()/print/<templateId>/<slug>[__n].bin`).
 *
 * Little endian:
 *
 *   offset 0   char[4]  "TMTP"
 *   offset 4   uint32   version (1)
 *   offset 8   uint32   vertex count V
 *   offset 12  uint32   triangle count T
 *   offset 16  float32  positions, V * 3 (x, y, z in mm)
 *   then       uint32   indices, T * 3 (counter-clockwise seen from outside)
 *
 * Frame: z up, the lowest vertex at z = 0, the centre of the XY bounding box at
 * (0, 0). The mesh is already turned about z to its minimum-area box, so a placed item only
 * needs `rotate(rotation about z)` then `translate(x, y)` from `ArrangedItem`.
 */
export const MESH_MAGIC = 'TMTP';
export const MESH_VERSION = 1;

export interface PrintMesh {
	positions: Float32Array;
	indices: Uint32Array;
}

export function encodeMesh(m: PrintMesh): Uint8Array {
	const v = m.positions.length / 3;
	const t = m.indices.length / 3;
	const out = new Uint8Array(16 + m.positions.byteLength + m.indices.byteLength);
	const dv = new DataView(out.buffer);
	for (let i = 0; i < 4; i++) out[i] = MESH_MAGIC.charCodeAt(i);
	dv.setUint32(4, MESH_VERSION, true);
	dv.setUint32(8, v, true);
	dv.setUint32(12, t, true);
	// DataView keeps this endian-correct on any host
	let o = 16;
	for (let i = 0; i < m.positions.length; i++, o += 4) dv.setFloat32(o, m.positions[i], true);
	for (let i = 0; i < m.indices.length; i++, o += 4) dv.setUint32(o, m.indices[i], true);
	return out;
}

export function decodeMesh(bytes: Uint8Array): PrintMesh {
	if (bytes.length < 16) throw new Error('Mesh file too short');
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
	if (magic !== MESH_MAGIC) throw new Error('Not a TMTP mesh');
	if (dv.getUint32(4, true) !== MESH_VERSION) throw new Error('Unsupported mesh version');
	const v = dv.getUint32(8, true);
	const t = dv.getUint32(12, true);
	if (bytes.length < 16 + v * 12 + t * 12) throw new Error('Mesh file truncated');
	const positions = new Float32Array(v * 3);
	const indices = new Uint32Array(t * 3);
	let o = 16;
	for (let i = 0; i < positions.length; i++, o += 4) positions[i] = dv.getFloat32(o, true);
	for (let i = 0; i < indices.length; i++, o += 4) indices[i] = dv.getUint32(o, true);
	return { positions, indices };
}
