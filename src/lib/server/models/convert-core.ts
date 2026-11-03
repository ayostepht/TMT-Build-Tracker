/**
 * STEP zip -> one GLB for a template. Runs inside the worker child process
 * (see worker.ts), never in the web server: a tire alone needs ~550 MB.
 *
 * Each template part becomes one mesh node named by its slug, in the STEP's
 * native frame (placements are applied at runtime by the viewer, so nudging
 * never needs a reconversion). Geometry is welded, quantised and meshopt
 * compressed (EXT_meshopt_compression).
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { unzipSync } from 'fflate';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import type { Occt, OcctResult } from 'occt-import-js';
import { matchParts, type MatchPart } from './match.ts';

export interface ReportEntry {
	file: string;
	slug: string | null;
	slugs?: string[];
	status: 'ok' | 'missing' | 'failed' | 'skipped' | 'unknown';
	triangles?: number;
	ms?: number;
	error?: string;
	detail?: string;
}

export interface ConvertResult {
	version: string;
	size: number;
	slugs: string[];
	triangles: number;
	report: ReportEntry[];
	ms: number;
}

export type ProgressFn = (pct: number, message: string) => void;

/** Tessellation from the spike: 1% of the bounding box, 1 rad. */
const TESSELLATION = {
	linearUnit: 'millimeter',
	linearDeflectionType: 'bounding_box_ratio',
	linearDeflection: 0.01,
	angularDeflection: 1.0
};

interface Geo {
	pos: Float32Array<ArrayBuffer>;
	nrm: Float32Array<ArrayBuffer>;
	idx: Uint32Array<ArrayBuffer>;
}

function mergeMeshes(res: OcctResult): Geo | null {
	let nv = 0;
	let ni = 0;
	for (const m of res.meshes) {
		nv += m.attributes.position.array.length;
		ni += m.index.array.length;
	}
	if (!ni) return null;
	const pos = new Float32Array(nv);
	const nrm = new Float32Array(nv);
	const idx = new Uint32Array(ni);
	let vo = 0;
	let io = 0;
	for (const m of res.meshes) {
		const p = m.attributes.position.array;
		const n = m.attributes.normal?.array;
		pos.set(p, vo);
		const ix = m.index.array;
		for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + vo / 3;
		if (n && n.length === p.length) nrm.set(n, vo);
		else computeNormals(pos, idx, nrm, vo, p.length, io, ix.length);
		vo += p.length;
		io += ix.length;
	}
	return { pos, nrm, idx };
}

/** Flat-ish vertex normals for one mesh slice (only used when OCCT returns none). */
function computeNormals(
	pos: Float32Array,
	idx: Uint32Array,
	out: Float32Array,
	vo: number,
	vlen: number,
	io: number,
	ilen: number
) {
	for (let i = io; i < io + ilen; i += 3) {
		const a = idx[i] * 3;
		const b = idx[i + 1] * 3;
		const c = idx[i + 2] * 3;
		const ux = pos[b] - pos[a];
		const uy = pos[b + 1] - pos[a + 1];
		const uz = pos[b + 2] - pos[a + 2];
		const vx = pos[c] - pos[a];
		const vy = pos[c + 1] - pos[a + 1];
		const vz = pos[c + 2] - pos[a + 2];
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		for (const o of [a, b, c]) {
			out[o] += nx;
			out[o + 1] += ny;
			out[o + 2] += nz;
		}
	}
	for (let i = vo; i < vo + vlen; i += 3) {
		const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
		out[i] /= l;
		out[i + 1] /= l;
		out[i + 2] /= l;
	}
}

function concatGeo(list: Geo[]): Geo {
	if (list.length === 1) return list[0];
	const nv = list.reduce((s, g) => s + g.pos.length, 0);
	const ni = list.reduce((s, g) => s + g.idx.length, 0);
	const pos = new Float32Array(nv);
	const nrm = new Float32Array(nv);
	const idx = new Uint32Array(ni);
	let vo = 0;
	let io = 0;
	for (const g of list) {
		pos.set(g.pos, vo);
		nrm.set(g.nrm, vo);
		for (let i = 0; i < g.idx.length; i++) idx[io + i] = g.idx[i] + vo / 3;
		vo += g.pos.length;
		io += g.idx.length;
	}
	return { pos, nrm, idx };
}

export async function convertStepZipToGlb(opts: {
	zipPath: string;
	/** Final GLB is written here via `<outPath>.tmp` + rename. */
	outPath: string;
	parts: MatchPart[];
	onProgress: ProgressFn;
}): Promise<ConvertResult> {
	const t0 = Date.now();
	const { zipPath, outPath, parts, onProgress } = opts;
	onProgress(2, 'Reading the zip');
	const zip = new Uint8Array(readFileSync(zipPath));
	const names: string[] = [];
	unzipSync(zip, {
		filter: (f) => {
			names.push(f.name);
			return false;
		}
	});
	const plan = matchParts(parts, names);

	const report: ReportEntry[] = [];
	for (const p of plan.parts)
		for (const w of p.missing)
			report.push({
				file: w,
				slug: p.slug,
				status: 'missing',
				detail: 'No matching file in the zip'
			});
	for (const e of plan.assemblies)
		report.push({ file: e, slug: null, status: 'skipped', detail: 'Assembly (not converted)' });
	for (const e of plan.obsolete)
		report.push({ file: e, slug: null, status: 'skipped', detail: 'OBSOLETE folder' });
	for (const e of plan.unknown)
		report.push({ file: e, slug: null, status: 'unknown', detail: 'Not used by any part' });

	const require = createRequire(import.meta.url);
	const initOcct = require('occt-import-js') as () => Promise<Occt>;
	let occt = await initOcct();

	const geoByFile = new Map<string, Geo>();
	const total = plan.files.length || 1;
	let done = 0;
	for (const f of plan.files) {
		const t = Date.now();
		onProgress(5 + Math.round((85 * done) / total), `Converting ${f.entry.split('/').pop()}`);
		try {
			const data = unzipSync(zip, { filter: (e) => e.name === f.entry })[f.entry];
			if (!data) throw new Error('Entry could not be read');
			const res = occt.ReadStepFile(data, TESSELLATION);
			if (!res.success) throw new Error('OpenCascade could not read the STEP file');
			const geo = mergeMeshes(res);
			if (!geo) throw new Error('The file has no geometry');
			geoByFile.set(f.entry, geo);
			report.push({
				file: f.entry,
				slug: f.slugs[0],
				slugs: f.slugs,
				status: 'ok',
				triangles: geo.idx.length / 3,
				ms: Date.now() - t
			});
		} catch (e) {
			report.push({
				file: f.entry,
				slug: f.slugs[0],
				slugs: f.slugs,
				status: 'failed',
				error: e instanceof Error ? e.message : String(e),
				ms: Date.now() - t
			});
			// A wasm abort leaves the module unusable: start a fresh one.
			occt = await initOcct();
		}
		done++;
	}

	onProgress(91, 'Building the model');
	const doc = new Document();
	const buffer = doc.createBuffer();
	const scene = doc.createScene('template');
	const material = doc
		.createMaterial('base')
		.setBaseColorFactor([0.8, 0.8, 0.8, 1])
		.setRoughnessFactor(0.55)
		.setMetallicFactor(0);
	const meshByFile = new Map<string, ReturnType<Document['createMesh']>>();
	const slugs: string[] = [];
	let triangles = 0;
	const makeMesh = (name: string, geo: Geo) => {
		const prim = doc
			.createPrimitive()
			.setMaterial(material)
			.setAttribute(
				'POSITION',
				doc.createAccessor().setType('VEC3').setArray(geo.pos).setBuffer(buffer)
			)
			.setAttribute(
				'NORMAL',
				doc.createAccessor().setType('VEC3').setArray(geo.nrm).setBuffer(buffer)
			)
			.setIndices(doc.createAccessor().setType('SCALAR').setArray(geo.idx).setBuffer(buffer));
		triangles += geo.idx.length / 3;
		return doc.createMesh(name).addPrimitive(prim);
	};
	for (const p of plan.parts) {
		const entries = p.entries.filter((e) => geoByFile.has(e));
		if (!entries.length) continue;
		let mesh;
		if (entries.length === 1) {
			mesh = meshByFile.get(entries[0]) ?? makeMesh(p.slug, geoByFile.get(entries[0])!);
			meshByFile.set(entries[0], mesh);
		} else {
			mesh = makeMesh(p.slug, concatGeo(entries.map((e) => geoByFile.get(e)!)));
		}
		scene.addChild(doc.createNode(p.slug).setMesh(mesh));
		slugs.push(p.slug);
	}
	if (!slugs.length) throw new Error('None of the template parts matched a file in the zip');
	geoByFile.clear();

	onProgress(93, 'Compressing');
	await MeshoptEncoder.ready;
	doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
		method: EXTMeshoptCompression.EncoderMethod.QUANTIZE
	});
	await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));

	onProgress(97, 'Writing');
	const io = new NodeIO()
		.registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
		.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
	const glb = await io.writeBinary(doc);
	mkdirSync(dirname(outPath), { recursive: true });
	const tmp = `${outPath}.tmp`;
	writeFileSync(tmp, glb);
	renameSync(tmp, outPath);
	const version = createHash('sha256').update(glb).digest('hex').slice(0, 16);
	return { version, size: glb.byteLength, slugs, triangles, report, ms: Date.now() - t0 };
}
