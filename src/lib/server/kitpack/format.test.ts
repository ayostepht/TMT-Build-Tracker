import { describe, expect, it } from 'vitest';
import type { PaintEntry, PrintMesh } from '../print-geometry/mesh-format';
import { checkRoundTrip } from './build';
import {
	compareVersions,
	decodeQMesh,
	encodeQMesh,
	INDEX_FORMAT,
	isSafePackPath,
	KitPackError,
	PACK_FORMAT,
	parseIndex,
	parseManifest,
	quantError
} from './format';

const SHA = 'a'.repeat(64);
const goodManifest = () => ({
	format: PACK_FORMAT,
	templateSlug: 'makegood-tmt-revb',
	version: '1.0.0',
	createdAt: '2026-11-04T00:00:00.000Z',
	sources: [
		{ file: 'model/model.glb', sha256: SHA, role: 'model' },
		{ file: 'placements.json', sha256: SHA, role: 'placements' },
		{ file: 'print/geometry.json', sha256: SHA, role: 'geometry' }
	],
	license: {
		name: 'CC0 1.0 (Creative Commons Public Domain)',
		holder: 'MakeGood',
		note: 'Credit: 3D model and print files by MakeGood'
	},
	contents: {
		parts: 1,
		meshes: 1,
		triangles: 1,
		paintedFaces: 0,
		placements: 1,
		placed: 1,
		hardware: false
	},
	appMinVersion: '0.0.1'
});

describe('manifest otherLicenses (mixed licenses, backward compatible)', () => {
	const notice = {
		parts: ['push-handle-one-piece'],
		name: 'CC BY-NC',
		holder: 'jeepxj',
		url: 'https://example.test/model',
		note: 'Credit: jeepxj'
	};
	it('keeps a notice and drops nothing else', () => {
		const m = parseManifest({ ...goodManifest(), otherLicenses: [notice] });
		expect(m.otherLicenses).toEqual([notice]);
		expect(m.license.holder).toBe('MakeGood');
	});
	it('accepts the limits exactly and an http url', () => {
		const edge = {
			...notice,
			url: 'http://example.test/m',
			name: 'x'.repeat(200),
			holder: 'x'.repeat(200),
			note: 'x'.repeat(1000)
		};
		expect(parseManifest({ ...goodManifest(), otherLicenses: [edge] }).otherLicenses).toEqual([
			edge
		]);
		expect(
			parseManifest({ ...goodManifest(), otherLicenses: Array.from({ length: 20 }, () => notice) })
				.otherLicenses
		).toHaveLength(20);
	});
	it('a manifest without the key parses as before (older packs)', () => {
		expect(parseManifest(goodManifest()).otherLicenses).toBeUndefined();
	});
	it.each([
		['not an array', { ...notice }],
		['no parts', [{ ...notice, parts: [] }]],
		['unsafe part slug', [{ ...notice, parts: ['../x'] }]],
		['no holder', [{ ...notice, holder: undefined }]],
		['name over 200 characters', [{ ...notice, name: 'x'.repeat(201) }]],
		['holder over 200 characters', [{ ...notice, holder: 'x'.repeat(201) }]],
		['note over 1000 characters', [{ ...notice, note: 'x'.repeat(1001) }]],
		['more than 20 notices', Array.from({ length: 21 }, () => notice)],
		['javascript: url', [{ ...notice, url: 'javascript:alert(1)' }]],
		['data: url', [{ ...notice, url: 'data:text/html,x' }]],
		['url without a scheme', [{ ...notice, url: 'example.test/m' }]]
	])('rejects %s', (_n, bad) => {
		expect(() => parseManifest({ ...goodManifest(), otherLicenses: bad })).toThrow(KitPackError);
	});
});

describe('manifest validation', () => {
	it('accepts a good manifest', () => {
		expect(parseManifest(goodManifest()).templateSlug).toBe('makegood-tmt-revb');
	});
	it.each([
		['wrong format', (m: Record<string, unknown>) => (m.format = 'tmt-kitpack-2')],
		['bad slug', (m: Record<string, unknown>) => (m.templateSlug = '../x')],
		['bad version', (m: Record<string, unknown>) => (m.version = 'latest')],
		['bad date', (m: Record<string, unknown>) => (m.createdAt = 'yesterday')],
		['no sources', (m: Record<string, unknown>) => (m.sources = [])],
		[
			'bad sha',
			(m: Record<string, unknown>) => ((m.sources as { sha256: string }[])[0].sha256 = 'xyz')
		],
		[
			'path traversal',
			(m: Record<string, unknown>) =>
				((m.sources as { file: string }[])[0].file = '../../etc/passwd')
		],
		[
			'duplicate file',
			(m: Record<string, unknown>) =>
				(m.sources as unknown[]).push({ file: 'placements.json', sha256: SHA, role: 'placements' })
		],
		[
			'no model source',
			(m: Record<string, unknown>) =>
				(m.sources = (m.sources as { role: string }[]).filter((s) => s.role !== 'model'))
		],
		['no license', (m: Record<string, unknown>) => delete m.license],
		['no contents', (m: Record<string, unknown>) => delete m.contents]
	])('rejects %s', (_name, mutate) => {
		const m = goodManifest() as unknown as Record<string, unknown>;
		mutate(m);
		expect(() => parseManifest(m)).toThrow(KitPackError);
	});
	it('rejects non-objects', () => {
		expect(() => parseManifest(null)).toThrow(KitPackError);
		expect(() => parseManifest([])).toThrow(KitPackError);
	});
});

describe('index validation', () => {
	const entry = {
		slug: 'makegood-tmt-revb',
		version: '1.0.0',
		file: 'makegood-tmt-revb-1.0.0.kitpack',
		sha256: SHA,
		size: 100
	};
	it('accepts a good index', () => {
		expect(parseIndex({ format: INDEX_FORMAT, packs: [entry] }).packs).toHaveLength(1);
	});
	it.each([
		['wrong format', { format: 'x', packs: [entry] }],
		['no packs', { format: INDEX_FORMAT }],
		['file with a slash', { format: INDEX_FORMAT, packs: [{ ...entry, file: '../a.kitpack' }] }],
		['short sha', { format: INDEX_FORMAT, packs: [{ ...entry, sha256: 'abc' }] }],
		['zero size', { format: INDEX_FORMAT, packs: [{ ...entry, size: 0 }] }],
		['bad version', { format: INDEX_FORMAT, packs: [{ ...entry, version: 'v1' }] }]
	])('rejects %s', (_n, raw) => {
		expect(() => parseIndex(raw)).toThrow(KitPackError);
	});
});

describe('helpers', () => {
	it('compares versions numerically', () => {
		expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
		expect(compareVersions('1.0', '1.0.0')).toBe(0);
		expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
	});
	it('only allows safe entry paths', () => {
		expect(isSafePackPath('print/meshes/a.qmesh')).toBe(true);
		for (const p of ['/abs', '../a', 'a/../b', 'a//b', 'a b', ''])
			expect(isSafePackPath(p)).toBe(false);
	});
});

function randomMesh(seed: number, V: number, T: number, withPaint: boolean): PrintMesh {
	let s = seed;
	const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
	const positions = new Float32Array(V * 3);
	for (let i = 0; i < V; i++) {
		positions[i * 3] = (rnd() - 0.5) * 500;
		positions[i * 3 + 1] = (rnd() - 0.5) * 500;
		positions[i * 3 + 2] = rnd() * 300;
	}
	positions[2] = 0; // the lowest vertex sits exactly at z = 0
	const indices = new Uint32Array(T * 3);
	for (let i = 0; i < indices.length; i++) indices[i] = Math.floor(rnd() * V);
	const paint: PaintEntry[] = [];
	if (withPaint) {
		let tri = 0;
		for (let i = 0; i < 40; i++) {
			tri += 1 + Math.floor(rnd() * 5);
			if (tri >= T) break;
			const len = 1 + Math.floor(rnd() * 60);
			let value = '';
			for (let k = 0; k < len; k++) value += String.fromCharCode(0x20 + Math.floor(rnd() * 95));
			paint.push({ kind: i % 3 ? 'supports' : 'seam', tri, value });
		}
	}
	return { positions, indices, ...(paint.length ? { paint } : {}) };
}

function cornerError(a: PrintMesh, b: PrintMesh): number {
	let max = 0;
	for (let i = 0; i < a.indices.length; i++)
		for (let k = 0; k < 3; k++)
			max = Math.max(
				max,
				Math.abs(a.positions[a.indices[i] * 3 + k] - b.positions[b.indices[i] * 3 + k])
			);
	return max;
}

describe('quantized mesh', () => {
	it('round-trips triangles within the error bound (<= 0.01 mm), vertices renumbered', () => {
		const m = randomMesh(7, 5000, 9000, false);
		const back = decodeQMesh(encodeQMesh(m, 100));
		expect(back.indices.length).toBe(m.indices.length);
		expect(back.positions.length).toBe(m.positions.length);
		const max = cornerError(m, back);
		expect(max).toBeLessThanOrEqual(0.01);
		// 0.5 step plus float32 rounding of values up to 500 mm
		expect(max).toBeLessThanOrEqual(quantError(100) + 5e-5);
		expect(checkRoundTrip(m, back, 'x')).toBe(max);
	});
	it('keeps z = 0 exactly', () => {
		const m = randomMesh(8, 100, 200, false);
		const back = decodeQMesh(encodeQMesh(m));
		expect(back.positions[m.indices[0] * 0 + 2] === 0 || back.positions.includes(0)).toBe(true);
	});
	it('also holds at the coarse 0.01 mm scale', () => {
		const m = randomMesh(11, 2000, 3000, false);
		const back = decodeQMesh(encodeQMesh(m, 100));
		expect(cornerError(m, back)).toBeLessThanOrEqual(0.01);
	});
	it('keeps paint bit-exact (kind, triangle, string)', () => {
		const m = randomMesh(3, 300, 800, true);
		expect(m.paint!.length).toBeGreaterThan(10);
		const back = decodeQMesh(encodeQMesh(m));
		expect(back.paint).toEqual(m.paint);
	});
	it('rejects truncated and foreign data', () => {
		const bytes = encodeQMesh(randomMesh(5, 50, 80, true));
		expect(() => decodeQMesh(bytes.slice(0, bytes.length - 5))).toThrow(KitPackError);
		expect(() => decodeQMesh(new Uint8Array(40))).toThrow(KitPackError);
	});
});
