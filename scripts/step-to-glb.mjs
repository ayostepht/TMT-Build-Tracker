#!/usr/bin/env node
/**
 * Offline tool: STEP assembly -> hardware GLB (casters, bolts, bearings, ...).
 *
 * The app converts the printed parts itself (STEP zip upload in the kit admin). The
 * assembly STEP is too big for that (about 1.4 GB of memory), so run this once on a
 * machine with enough RAM and upload the result as the kit's "hardware GLB".
 *
 *   node --max-old-space-size=4096 scripts/step-to-glb.mjs <assembly.step> <hardware.glb> [options]
 *
 * Options
 *   --list                 print every product name in the assembly and exit (no GLB written)
 *   --include <regex>      keep products whose name matches (default: McMaster-style part numbers
 *                          and bearing|locknut|screw|bolt|washer|nut)
 *   --max-size <mm>        keep only bodies whose longest side is at most this (pulls small hardware
 *                          out of a printed sub-assembly, e.g. --include "Wheel Assembly" --max-size 40)
 *   --exclude <regex>      drop products whose name matches (applied after --include)
 *   --lin <ratio>          tessellation: linear deflection as a bounding-box ratio (default 0.01)
 *   --ang <rad>            tessellation: angular deflection (default 1.0)
 *
 * Output: one mesh node per kept body, named `hw:<product>` (so the viewer renders it neutral
 * grey and not pickable), in the assembly's own frame, welded and meshopt compressed.
 *
 * Needs only the app's dependencies (`npm ci`): occt-import-js, @gltf-transform/*, meshoptimizer.
 * Never commit the STEP file or the GLB: they derive from MakeGood's files.
 */
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const usage =
	'usage: step-to-glb.mjs <assembly.step> <hardware.glb> [--include re] [--exclude re] [--lin n] [--ang n]\n' +
	'       step-to-glb.mjs <assembly.step> --list';

let parsed;
try {
	parsed = parseArgs({
		allowPositionals: true,
		options: {
			list: { type: 'boolean', default: false },
			include: { type: 'string' },
			exclude: { type: 'string' },
			'max-size': { type: 'string' },
			lin: { type: 'string', default: '0.01' },
			ang: { type: 'string', default: '1.0' }
		}
	});
} catch (e) {
	console.error(e.message + '\n' + usage);
	process.exit(2);
}
const { values: opt, positionals } = parsed;
const [inFile, outFile] = positionals;
if (!inFile || (!outFile && !opt.list)) {
	console.error(usage);
	process.exit(2);
}

const include = new RegExp(
	opt.include ?? '^\\d{4,}[A-Z]\\d+_|bearing|locknut|screw|bolt|washer|\\bnut\\b',
	'i'
);
const maxSize = opt['max-size'] ? Number(opt['max-size']) : 0;
const exclude = opt.exclude ? new RegExp(opt.exclude, 'i') : null;

const require = createRequire(import.meta.url);
const occt = await require('occt-import-js')();
const t0 = Date.now();
console.error(
	`reading ${inFile} (${(statSync(inFile).size / 1e6).toFixed(1)} MB), this can take a minute`
);
const res = occt.ReadStepFile(new Uint8Array(readFileSync(inFile)), {
	linearUnit: 'millimeter',
	linearDeflectionType: 'bounding_box_ratio',
	linearDeflection: Number(opt.lin),
	angularDeflection: Number(opt.ang)
});
if (!res.success) {
	console.error('OpenCascade could not read the STEP file');
	process.exit(1);
}
console.error(`read ${res.meshes.length} bodies in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// Walk the product tree: the nearest named ancestor is the product a body belongs to.
const bodies = [];
(function walk(node, stack) {
	const names = node.name ? [...stack, node.name] : stack;
	for (const mi of node.meshes)
		bodies.push({ mesh: res.meshes[mi], product: names[names.length - 1] ?? 'root' });
	for (const child of node.children) walk(child, names);
})(res.root, []);

if (opt.list) {
	const counts = new Map();
	for (const b of bodies) counts.set(b.product, (counts.get(b.product) ?? 0) + 1);
	for (const [name, n] of [...counts].sort()) console.log(`${n}\t${name}`);
	process.exit(0);
}

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('hardware');
const material = doc
	.createMaterial('hardware')
	.setBaseColorFactor([0.55, 0.57, 0.61, 1])
	.setMetallicFactor(0.5)
	.setRoughnessFactor(0.45);
const used = new Map();
let kept = 0;
let triangles = 0;
for (const { mesh: m, product } of bodies) {
	if (!include.test(product) || (exclude && exclude.test(product))) continue;
	if (maxSize) {
		const p = m.attributes.position.array;
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < p.length; i += 3)
			for (let k = 0; k < 3; k++) {
				lo[k] = Math.min(lo[k], p[i + k]);
				hi[k] = Math.max(hi[k], p[i + k]);
			}
		if (Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) > maxSize) continue;
	}
	const pos = new Float32Array(m.attributes.position.array);
	const idx = Uint32Array.from(m.index.array);
	let nrm;
	if (m.attributes.normal) nrm = new Float32Array(m.attributes.normal.array);
	else {
		nrm = new Float32Array(pos.length);
		for (let i = 0; i < idx.length; i += 3) {
			const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
			const u = [0, 1, 2].map((k) => pos[b + k] - pos[a + k]);
			const v = [0, 1, 2].map((k) => pos[c + k] - pos[a + k]);
			const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
			for (const o of [a, b, c]) for (let k = 0; k < 3; k++) nrm[o + k] += n[k];
		}
		for (let i = 0; i < nrm.length; i += 3) {
			const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
			nrm[i] /= l;
			nrm[i + 1] /= l;
			nrm[i + 2] /= l;
		}
	}
	const n = (used.get(product) ?? 0) + 1;
	used.set(product, n);
	const name = `hw:${product.replace(/\s+/g, '_')}#${n}`;
	const prim = doc
		.createPrimitive()
		.setMaterial(material)
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
		.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer))
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer));
	scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
	kept++;
	triangles += idx.length / 3;
}
if (!kept) {
	console.error('No body matched --include; run with --list to see the product names.');
	process.exit(1);
}

await MeshoptEncoder.ready;
doc
	.createExtension(EXTMeshoptCompression)
	.setRequired(true)
	.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await new NodeIO()
	.registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
	.registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
	.write(outFile, doc);
console.error(
	`wrote ${outFile}: ${kept} of ${bodies.length} bodies, ${triangles.toLocaleString()} triangles, ` +
		`${(statSync(outFile).size / 1e6).toFixed(2)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s`
);
