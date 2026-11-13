import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
	addNodeToGlb,
	creaseNormals,
	readThreeMfObject,
	simplifyForView,
	type MeshData
} from './model-node';
import { KitPackError } from './format';

// A 2 x 4 x 6 box (12 triangles) centred on the origin, the way a slicer stores an imported object.
const BOX_V = [
	[-1, -2, -3],
	[1, -2, -3],
	[1, 2, -3],
	[-1, 2, -3],
	[-1, -2, 3],
	[1, -2, 3],
	[1, 2, 3],
	[-1, 2, 3]
];
const BOX_T = [
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
const objectXml = () =>
	`<model><resources><object id="1"><mesh><vertices>${BOX_V.map(
		(v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`
	).join('')}</vertices><triangles>${BOX_T.map(
		(t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" paint_supports="4"/>`
	).join('')}</triangles></mesh></object></resources></model>`;
const settings = (offset: string) =>
	`<config><object id="2"><metadata key="name" value="box.stl"/><part id="1">${offset}</part></object></config>`;
const OFFSET =
	'<metadata key="source_offset_x" value="10"/><metadata key="source_offset_y" value="565.5"/><metadata key="source_offset_z" value="-548.25"/>';
const threeMf = (opt: { offset?: string; comp?: string } = {}) =>
	zipSync({
		'3D/3dmodel.model': strToU8(
			`<model><resources><object id="2"><components><component p:path="/3D/Objects/object_2.model" objectid="1" transform="${opt.comp ?? '1 0 0 0 1 0 0 0 1 0 0 0'}"/></components></object></resources></model>`
		),
		'3D/Objects/object_2.model': strToU8(objectXml()),
		'Metadata/model_settings.config': strToU8(settings(opt.offset ?? OFFSET))
	});

describe('readThreeMfObject', () => {
	it('adds the source offset back (the designer frame) and keeps the triangles', () => {
		const o = readThreeMfObject(threeMf());
		expect(o.name).toBe('box.stl');
		expect(o.offset).toEqual([10, 565.5, -548.25]);
		expect(o.indices).toHaveLength(36);
		expect([...o.positions.subarray(0, 3)]).toEqual([9, 563.5, -551.25]);
		const y = Array.from({ length: 8 }, (_, i) => o.positions[i * 3 + 1]);
		expect(Math.min(...y)).toBe(563.5);
		expect(Math.max(...y)).toBe(567.5);
	});
	it('applies the component transform (a small shift)', () => {
		const o = readThreeMfObject(threeMf({ comp: '1 0 0 0 1 0 0 0 1 0 0 -1' }));
		expect(o.positions[2]).toBe(-552.25);
	});
	it('refuses a file without source_offset', () => {
		expect(() => readThreeMfObject(threeMf({ offset: '' }))).toThrow(KitPackError);
	});
	it('refuses a file with two objects', () => {
		const files = {
			'3D/3dmodel.model': strToU8(
				'<model><resources><object id="1"><mesh/></object><object id="2"><mesh/></object></resources></model>'
			)
		};
		expect(() => readThreeMfObject(zipSync(files))).toThrow(/one object/);
	});
});

describe('creaseNormals', () => {
	it('keeps the box edges sharp: every corner normal is axis aligned', () => {
		const m: MeshData = {
			positions: Float32Array.from(BOX_V.flat()),
			indices: Uint32Array.from(BOX_T.flat())
		};
		const n = creaseNormals(m);
		expect(n.indices).toHaveLength(36);
		for (let i = 0; i < 36; i++) {
			const v = [n.normals[i * 3], n.normals[i * 3 + 1], n.normals[i * 3 + 2]].map(Math.abs);
			expect(Math.max(...v)).toBeCloseTo(1, 5);
		}
	});
	it('outward normals for the outward wound box', () => {
		const m: MeshData = {
			positions: Float32Array.from(BOX_V.flat()),
			indices: Uint32Array.from(BOX_T.flat())
		};
		const n = creaseNormals(m);
		for (let i = 0; i < 36; i++) {
			const p = [n.positions[i * 3], n.positions[i * 3 + 1], n.positions[i * 3 + 2]];
			const nn = [n.normals[i * 3], n.normals[i * 3 + 1], n.normals[i * 3 + 2]];
			expect(p[0] * nn[0] + p[1] * nn[1] + p[2] * nn[2]).toBeGreaterThan(0);
		}
	});
});

describe('simplifyForView', () => {
	it('returns small meshes unchanged', async () => {
		const m: MeshData = {
			positions: Float32Array.from(BOX_V.flat()),
			indices: Uint32Array.from(BOX_T.flat())
		};
		expect(await simplifyForView(m)).toBe(m);
	});
});

describe('addNodeToGlb', () => {
	const baseGlb = async () => {
		await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
		const doc = new Document();
		const buffer = doc.createBuffer();
		const scene = doc.createScene('template');
		const material = doc.createMaterial('base');
		const pos = Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0]);
		const prim = doc
			.createPrimitive()
			.setMaterial(material)
			.setAttribute(
				'POSITION',
				doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer)
			)
			.setAttribute(
				'NORMAL',
				doc
					.createAccessor()
					.setType('VEC3')
					.setArray(Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]))
					.setBuffer(buffer)
			)
			.setIndices(
				doc
					.createAccessor()
					.setType('SCALAR')
					.setArray(Uint32Array.from([0, 1, 2, 1, 3, 2]))
					.setBuffer(buffer)
			);
		scene.addChild(doc.createNode('seat').setMesh(doc.createMesh('seat').addPrimitive(prim)));
		doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
			method: EXTMeshoptCompression.EncoderMethod.QUANTIZE
		});
		await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
		return new NodeIO()
			.registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
			.registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
			.writeBinary(doc);
	};
	const worldBox = async (glb: Uint8Array, name: string) => {
		const doc = await new NodeIO()
			.registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
			.registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
			.readBinary(glb);
		const n = doc
			.getRoot()
			.listNodes()
			.find((x) => x.getName() === name)!;
		const t = n.getTranslation();
		const s = n.getScale();
		const a = n.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!;
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		const v = [0, 0, 0];
		for (let i = 0; i < a.getCount(); i++) {
			a.getElement(i, v);
			for (let k = 0; k < 3; k++) {
				const w = v[k] * s[k] + t[k];
				min[k] = Math.min(min[k], w);
				max[k] = Math.max(max[k], w);
			}
		}
		return { min, max, tris: n.getMesh()!.listPrimitives()[0].getIndices()!.getCount() / 3 };
	};

	it('adds a node in the given frame and leaves the existing one where it was', async () => {
		const base = await baseGlb();
		const o = readThreeMfObject(threeMf());
		const r = await addNodeToGlb(base, 'one-piece', o);
		expect(r.slugs).toEqual(['seat', 'one-piece']);
		const seat = await worldBox(r.glb, 'seat');
		expect(seat.min.map((v) => Math.round(v * 100) / 100)).toEqual([0, 0, 0]);
		expect(seat.max.map((v) => Math.round(v * 100) / 100)).toEqual([10, 10, 0]);
		expect(seat.tris).toBe(2);
		const box = await worldBox(r.glb, 'one-piece');
		expect(box.tris).toBe(12);
		expect(box.min[1]).toBeCloseTo(563.5, 1);
		expect(box.max[1]).toBeCloseTo(567.5, 1);
		expect(box.min[2]).toBeCloseTo(-551.25, 1);
		expect(box.max[2]).toBeCloseTo(-545.25, 1);
	});
	it('refuses a slug that is already in the model', async () => {
		const base = await baseGlb();
		await expect(addNodeToGlb(base, 'seat', readThreeMfObject(threeMf()))).rejects.toThrow(
			KitPackError
		);
	});
});
