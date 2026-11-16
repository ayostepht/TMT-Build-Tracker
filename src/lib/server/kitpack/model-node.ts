/**
 * Adds one part to a template's 3D model (GLB) from a slicer 3MF, for parts that have no STEP
 * file (a community design published only as an STL / 3MF). Maintainer tooling for
 * `scripts/build-kit-pack.mjs --model-node <slug>=<file.3mf>`; never runs in the app.
 *
 * The node is the object's own mesh in the frame the designer exported it in, which for a part
 * made against the MakeGood assembly is the assembly frame, so its placement is the identity
 * (like the STEP parts). Bambu / Orca centre an imported object on its bounding box and keep the
 * original position as `source_offset` in `Metadata/model_settings.config`: adding it back
 * restores that frame. The build item's own transform (how the object lies on the plate) is
 * ignored on purpose: the 3D view shows the assembled part, the print geometry keeps the plate
 * pose (see `print-geometry/`); nothing here changes how a part is printed.
 *
 * Check the result against a part that is already placed before packing (the one-piece push
 * handle ends exactly where the multi-part bottom ends); the 3MF alone cannot prove the frame.
 */
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { and, eq } from 'drizzle-orm';
import { templateModelPath } from '../config';
import type { Db } from '../db';
import { templateModels, templatePrintGeometry } from '../db/schema';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import { KitPackError } from './format';

export interface MeshData {
	/** x, y, z in mm. */
	positions: Float32Array;
	indices: Uint32Array;
}

export interface ThreeMfObject extends MeshData {
	name: string;
	/** The `source_offset` that was added to bring the mesh back into the designer's frame. */
	offset: [number, number, number];
}

const num = (s: string | undefined, what: string): number => {
	const v = Number(s);
	if (s === undefined || !Number.isFinite(v))
		throw new KitPackError(`3MF: ${what} is not a number`);
	return v;
};
const attr = (tag: string, name: string): string | undefined =>
	new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Row-vector 3MF transform (12 numbers: m00 m01 m02 m10 .. m22 tx ty tz). */
function parseTransform(s: string | undefined): number[] | null {
	if (!s) return null;
	const t = s.trim().split(/\s+/).map(Number);
	return t.length === 12 && t.every(Number.isFinite) ? t : null;
}

/**
 * The one mesh of a single-object slicer 3MF, in the designer's own frame (see the file header).
 * Throws for anything else (several objects, no `source_offset`): those need a human decision.
 */
export function readThreeMfObject(bytes: Uint8Array): ThreeMfObject {
	const files = unzipSync(bytes, {
		filter: (f) =>
			f.name === '3D/3dmodel.model' ||
			f.name === 'Metadata/model_settings.config' ||
			/^3D\/Objects\/[^/]+\.model$/.test(f.name)
	});
	const main = files['3D/3dmodel.model'];
	if (!main) throw new KitPackError('3MF: 3D/3dmodel.model is missing');
	const mainXml = strFromU8(main);
	const objects = [...mainXml.matchAll(/<object\b[^>]*>[\s\S]*?<\/object>/g)].map((m) => m[0]);
	if (objects.length !== 1)
		throw new KitPackError(`3MF: expected one object, found ${objects.length}`);
	const obj = objects[0];
	const comps = [...obj.matchAll(/<component\b[^>]*>/g)].map((m) => m[0]);
	let xml: string;
	let transform: number[] | null = null;
	if (comps.length) {
		if (comps.length !== 1)
			throw new KitPackError(`3MF: the object has ${comps.length} components, expected one`);
		const path = (attr(comps[0], 'p:path') ?? '').replace(/^\//, '');
		const file = files[path];
		if (!file) throw new KitPackError(`3MF: ${path || 'the component file'} is missing`);
		xml = strFromU8(file);
		transform = parseTransform(attr(comps[0], 'transform'));
	} else xml = obj;

	const positions: number[] = [];
	for (const m of xml.matchAll(/<vertex\b[^>]*>/g)) {
		positions.push(
			num(attr(m[0], 'x'), 'vertex x'),
			num(attr(m[0], 'y'), 'vertex y'),
			num(attr(m[0], 'z'), 'vertex z')
		);
	}
	const indices: number[] = [];
	for (const m of xml.matchAll(/<triangle\b[^>]*>/g))
		indices.push(
			num(attr(m[0], 'v1'), 'triangle v1'),
			num(attr(m[0], 'v2'), 'triangle v2'),
			num(attr(m[0], 'v3'), 'triangle v3')
		);
	const nv = positions.length / 3;
	if (!nv || !indices.length) throw new KitPackError('3MF: the object has no mesh');
	if (indices.some((i) => i < 0 || i >= nv))
		throw new KitPackError('3MF: triangle index out of range');

	const settings = files['Metadata/model_settings.config'];
	const cfg = settings ? strFromU8(settings) : '';
	const off = (axis: string) =>
		new RegExp(`key="source_offset_${axis}"\\s+value="([^"]*)"`).exec(cfg)?.[1];
	const sx = off('x');
	if (sx === undefined)
		throw new KitPackError(
			'3MF: no source_offset in model_settings.config, so the designer frame cannot be restored'
		);
	const offset: [number, number, number] = [
		num(sx, 'source_offset_x'),
		num(off('y'), 'source_offset_y'),
		num(off('z'), 'source_offset_z')
	];
	const name = /<metadata\s+key="name"\s+value="([^"]*)"/.exec(cfg)?.[1] ?? 'part';

	const out = new Float32Array(positions.length);
	for (let i = 0; i < nv; i++) {
		let x = positions[i * 3];
		let y = positions[i * 3 + 1];
		let z = positions[i * 3 + 2];
		if (transform) {
			const t = transform;
			[x, y, z] = [
				x * t[0] + y * t[3] + z * t[6] + t[9],
				x * t[1] + y * t[4] + z * t[7] + t[10],
				x * t[2] + y * t[5] + z * t[8] + t[11]
			];
		}
		out[i * 3] = x + offset[0];
		out[i * 3 + 1] = y + offset[1];
		out[i * 3 + 2] = z + offset[2];
	}
	return { name, positions: out, indices: Uint32Array.from(indices), offset };
}

/**
 * Lighter mesh for the viewer (the print mesh keeps every triangle): meshopt simplification to about
 * `maxTriangles` within `errorRatio` of the part's size. Returns a compacted mesh.
 */
export async function simplifyForView(
	m: MeshData,
	maxTriangles = 12000,
	errorRatio = 0.002
): Promise<MeshData> {
	if (m.indices.length / 3 <= maxTriangles) return m;
	await MeshoptSimplifier.ready;
	const [idx] = MeshoptSimplifier.simplify(
		m.indices,
		m.positions,
		3,
		maxTriangles * 3,
		errorRatio,
		['ErrorClamped' as never]
	);
	// compact: keep only used vertices
	const remap = new Map<number, number>();
	const pos: number[] = [];
	const indices = new Uint32Array(idx.length);
	for (let i = 0; i < idx.length; i++) {
		let n = remap.get(idx[i]);
		if (n === undefined) {
			n = remap.size;
			remap.set(idx[i], n);
			pos.push(m.positions[idx[i] * 3], m.positions[idx[i] * 3 + 1], m.positions[idx[i] * 3 + 2]);
		}
		indices[i] = n;
	}
	return { positions: Float32Array.from(pos), indices };
}

/**
 * Per-corner normals, smooth across faces closer than `creaseDeg` (area weighted) and sharp
 * beyond it, so a flat part keeps its edges. Returns an unindexed mesh (3 vertices per triangle);
 * `weld()` merges the corners again.
 */
export function creaseNormals(
	m: MeshData,
	creaseDeg = 35
): {
	positions: Float32Array<ArrayBuffer>;
	normals: Float32Array<ArrayBuffer>;
	indices: Uint32Array<ArrayBuffer>;
} {
	const nt = m.indices.length / 3;
	const faceN = new Float32Array(nt * 3); // area weighted (unnormalised) normals
	const unit = new Float32Array(nt * 3);
	for (let t = 0; t < nt; t++) {
		const [a, b, c] = [m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2]];
		const p = m.positions;
		const ux = p[b * 3] - p[a * 3];
		const uy = p[b * 3 + 1] - p[a * 3 + 1];
		const uz = p[b * 3 + 2] - p[a * 3 + 2];
		const vx = p[c * 3] - p[a * 3];
		const vy = p[c * 3 + 1] - p[a * 3 + 1];
		const vz = p[c * 3 + 2] - p[a * 3 + 2];
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		faceN.set([nx, ny, nz], t * 3);
		const len = Math.hypot(nx, ny, nz) || 1;
		unit.set([nx / len, ny / len, nz / len], t * 3);
	}
	const byVertex: number[][] = Array.from({ length: m.positions.length / 3 }, () => []);
	for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) byVertex[m.indices[t * 3 + k]].push(t);
	const cos = Math.cos((creaseDeg * Math.PI) / 180);
	const positions = new Float32Array(nt * 9);
	const normals = new Float32Array(nt * 9);
	const indices = new Uint32Array(nt * 3);
	for (let t = 0; t < nt; t++) {
		for (let k = 0; k < 3; k++) {
			const v = m.indices[t * 3 + k];
			let sx = 0;
			let sy = 0;
			let sz = 0;
			for (const u of byVertex[v]) {
				const d =
					unit[t * 3] * unit[u * 3] +
					unit[t * 3 + 1] * unit[u * 3 + 1] +
					unit[t * 3 + 2] * unit[u * 3 + 2];
				if (d >= cos) {
					sx += faceN[u * 3];
					sy += faceN[u * 3 + 1];
					sz += faceN[u * 3 + 2];
				}
			}
			const len = Math.hypot(sx, sy, sz) || 1;
			const o = (t * 3 + k) * 3;
			positions.set(m.positions.subarray(v * 3, v * 3 + 3), o);
			normals.set([sx / len, sy / len, sz / len], o);
			indices[t * 3 + k] = t * 3 + k;
		}
	}
	return { positions, normals, indices };
}

const io = () =>
	new NodeIO()
		.registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
		.registerDependencies({
			'meshopt.decoder': MeshoptDecoder,
			'meshopt.encoder': MeshoptEncoder
		});

/**
 * Returns the GLB with one more node `slug` holding `mesh` (same grey material as the others),
 * welded, quantised and meshopt compressed exactly like the converter does. Existing nodes keep
 * their names and world positions (quantising already quantised data lands on the same grid).
 */
export async function addNodeToGlb(
	glb: Uint8Array,
	slug: string,
	mesh: MeshData
): Promise<{ glb: Uint8Array; slugs: string[] }> {
	await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
	const doc = await io().readBinary(glb);
	const root = doc.getRoot();
	if (root.listNodes().some((n) => n.getName() === slug))
		throw new KitPackError(`The model already has a node "${slug}"`);
	const scene = root.listScenes()[0];
	if (!scene) throw new KitPackError('The model has no scene');
	const material = root.listMaterials()[0] ?? null;
	const buffer = root.listBuffers()[0] ?? doc.createBuffer();
	const shaded = creaseNormals(mesh);
	const prim = doc
		.createPrimitive()
		.setAttribute(
			'POSITION',
			doc.createAccessor().setType('VEC3').setArray(shaded.positions).setBuffer(buffer)
		)
		.setAttribute(
			'NORMAL',
			doc.createAccessor().setType('VEC3').setArray(shaded.normals).setBuffer(buffer)
		)
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(shaded.indices).setBuffer(buffer));
	if (material) prim.setMaterial(material);
	scene.addChild(doc.createNode(slug).setMesh(doc.createMesh(slug).addPrimitive(prim)));
	doc
		.createExtension(EXTMeshoptCompression)
		.setRequired(true)
		.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
	await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
	const out = await io().writeBinary(doc);
	return {
		glb: out,
		slugs: root
			.listNodes()
			.filter((n) => n.getMesh())
			.map((n) => n.getName())
	};
}

/**
 * Adds the object of `threeMfPath` as node `slug` to the template's installed model and records it in
 * `template_models` (`slugs`, `version`, `size`; the source note is kept). The next
 * `buildKitPack` packs it.
 */
export async function addModelNodeFrom3mf(
	db: Db,
	templateId: string,
	slug: string,
	threeMfPath: string,
	log: (m: string) => void = () => {}
): Promise<{ slugs: string[]; triangles: number; box: { min: number[]; max: number[] } }> {
	if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) throw new KitPackError('Invalid part slug');
	const row = db
		.select()
		.from(templateModels)
		.where(eq(templateModels.templateId, templateId))
		.get();
	if (!row) throw new KitPackError('The template has no 3D model yet');
	const path = templateModelPath(templateId);
	const object = readThreeMfObject(new Uint8Array(readFileSync(threeMfPath)));
	const triangles = object.indices.length / 3;
	const view = await simplifyForView(object);
	log(`${slug}: ${triangles} triangles read, ${view.indices.length / 3} for the view`);
	const added = await addNodeToGlb(new Uint8Array(readFileSync(path)), slug, view);
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, added.glb);
	renameSync(tmp, path);
	const version = createHash('sha256').update(added.glb).digest('hex').slice(0, 16);
	db.update(templateModels)
		.set({ slugs: added.slugs, version, size: added.glb.byteLength })
		.where(eq(templateModels.templateId, templateId))
		.run();
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < object.positions.length; i++) {
		min[i % 3] = Math.min(min[i % 3], object.positions[i]);
		max[i % 3] = Math.max(max[i % 3], object.positions[i]);
	}
	return { slugs: added.slugs, triangles, box: { min, max } };
}

/** Project-level process settings that describe the part (a designer's profile for a single-object project). */
const PROJECT_KEYS = [
	'layer_height',
	'wall_loops',
	'sparse_infill_density',
	'sparse_infill_pattern',
	'top_shell_layers',
	'bottom_shell_layers',
	'enable_support',
	'support_type',
	'brim_type',
	'brim_width'
];

/**
 * A single-object slicer project keeps the designer's walls, infill and supports in the project
 * (process) settings, not as per-object overrides, so the geometry import finds none. Copies those
 * keys into the part's stored print settings (pieces and row), so a 3MF exported later carries them
 * like it does for MakeGood's own parts. The part must already have imported geometry.
 */
export function applyProjectSettings(
	db: Db,
	templateId: string,
	slug: string,
	threeMfPath: string
): Record<string, string> {
	const files = unzipSync(new Uint8Array(readFileSync(threeMfPath)), {
		filter: (f) => f.name === 'Metadata/project_settings.config'
	});
	const raw = files['Metadata/project_settings.config'];
	if (!raw) throw new KitPackError('3MF: Metadata/project_settings.config is missing');
	const project = JSON.parse(strFromU8(raw)) as Record<string, unknown>;
	const picked: Record<string, string> = {};
	for (const k of PROJECT_KEYS)
		if (typeof project[k] === 'string') picked[k] = project[k] as string;
	if (!Object.keys(picked).length) throw new KitPackError('3MF: no print settings found');
	const row = db
		.select()
		.from(templatePrintGeometry)
		.where(
			and(eq(templatePrintGeometry.templateId, templateId), eq(templatePrintGeometry.slug, slug))
		)
		.get();
	if (!row) throw new KitPackError(`${slug} has no print geometry yet (import the 3MF first)`);
	const fp = structuredClone(row.footprint) as unknown as PrintFootprint;
	for (const pc of fp.pieces) pc.settings = { ...pc.settings, ...picked };
	db.update(templatePrintGeometry)
		.set({
			footprint: fp as unknown as Record<string, unknown>,
			settings: { ...row.settings, ...picked }
		})
		.where(
			and(eq(templatePrintGeometry.templateId, templateId), eq(templatePrintGeometry.slug, slug))
		)
		.run();
	return picked;
}
