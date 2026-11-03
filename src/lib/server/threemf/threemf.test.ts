import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseThreeMf, parseThreeMfBytes, parseThreeMfFile, ThreeMfError } from './index';
import { makePlainThreeMf, makeProjectThreeMf, TINY_PNG } from './fixtures';

async function* chunks(bytes: Uint8Array, size: number) {
	for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

describe('Bambu Studio project, sliced', () => {
	const bytes = makeProjectThreeMf({
		sliced: true,
		filamentTypes: ['PETG', 'TPU'],
		plates: [
			{
				name: 'WING LEFT',
				objects: [{ name: '3DTMT C1 WING LEFT REV B.step' }],
				prediction: 45036,
				weight: 612.4,
				filaments: { 1: 612.4 }
			},
			{
				name: 'WHEEL RIM (PRINT X4)',
				objects: [{ name: '3DTMT O WHEEL RIM REV B.STEP' }],
				prediction: 34992,
				filaments: { 1: 100.5, 2: 20.25 }
			},
			{
				name: 'TIRES',
				objects: [{ name: '3DTMT P TIRE REV A.STEP', extruder: 2, instances: 16 }]
			}
		]
	});

	it('reads printer, filaments, plates, times, grams and thumbnails', async () => {
		const s = await parseThreeMfBytes(bytes);
		expect(s.kind).toBe('project');
		expect(s.sliced).toBe(true);
		expect(s.app).toBe('BambuStudio-02.06.00.51');
		expect(s.printer).toBe('Bambu Lab H2D');
		expect(s.nozzle).toBe(0.4);
		expect(s.layerHeight).toBe(0.2);
		expect(s.filaments).toEqual([
			{ index: 1, type: 'PETG', color: '#00FF00', name: 'Bambu PETG Basic' },
			{ index: 2, type: 'TPU', color: '#FFFF00', name: 'Bambu TPU Basic' }
		]);
		expect(s.plates.map((p) => p.index)).toEqual([1, 2, 3]);
		const [wing, rim, tires] = s.plates;
		expect(wing).toMatchObject({ name: 'WING LEFT', estSeconds: 45036, grams: 612.4, runsHint: 1 });
		expect(wing.filamentGrams).toEqual({ '1': 612.4 });
		expect(wing.thumbnail).toEqual(TINY_PNG);
		expect(rim.runsHint).toBe(4);
		expect(rim.grams).toBe(120.75); // no weight in the file: sum of the filaments
		expect(rim.filamentGrams).toEqual({ '1': 100.5, '2': 20.25 });
		expect(tires.estSeconds).toBeNull();
		expect(tires.objects).toEqual([
			{ id: expect.any(String), name: '3DTMT P TIRE REV A.STEP', filamentIndex: 2, count: 16 }
		]);
		expect(s.warnings).toEqual([]);
	});

	it('gives the same result from a stream of tiny chunks and from a file', async () => {
		const a = await parseThreeMfBytes(bytes);
		const b = await parseThreeMf(chunks(bytes, 97));
		expect(b).toEqual(a);
	});

	it('never inflates 3D/Objects', async () => {
		// Corrupt the deflated geometry entry: reading it would fail, skipping it must not.
		const z = makeProjectThreeMf({
			plates: [{ objects: [{ name: 'x' }] }],
			extra: { '3D/Objects/big.model': strToU8('<mesh>'.repeat(5000)) }
		});
		const name = strToU8('3D/Objects/big.model');
		let at = -1;
		outer: for (let i = 0; i < z.length - name.length; i++) {
			for (let j = 0; j < name.length; j++) if (z[i + j] !== name[j]) continue outer;
			at = i;
			break;
		}
		expect(at).toBeGreaterThan(0);
		const bad = z.slice();
		for (let k = 0; k < 8; k++) bad[at + name.length + k] = 0xff;
		const s = await parseThreeMfBytes(bad);
		expect(s.plates).toHaveLength(1);
	});
});

describe('Bambu Studio project, not sliced', () => {
	it('has no times or grams but keeps everything else', async () => {
		const s = await parseThreeMfBytes(
			makeProjectThreeMf({
				plates: [{ name: 'A', objects: [{ name: 'one' }, { name: 'one' }, { name: 'two' }] }]
			})
		);
		expect(s.sliced).toBe(false);
		const p = s.plates[0];
		expect(p.estSeconds).toBeNull();
		expect(p.grams).toBeNull();
		expect(p.filamentGrams).toEqual({});
		// two objects both named "one" collapse into a count
		expect(p.objects.map((o) => [o.name, o.count])).toEqual([
			['one', 2],
			['two', 1]
		]);
	});
});

describe('OrcaSlicer family (Elegoo Slicer)', () => {
	it('copes with the Orca quirks', async () => {
		const s = await parseThreeMfBytes(
			makeProjectThreeMf({
				app: 'OrcaSlicer-2.3.0',
				printerModel: '',
				printerSettingsId: 'Elegoo Centauri Carbon 0.4 nozzle',
				filamentTypes: ['PLA', 'PLA', 'TPU'],
				filamentColours: ['#FFFFFFFF', '#FF0000FF', 'garbage'],
				filamentIds: ['Elegoo PLA @0.4', 'Elegoo PLA @0.4', ''],
				sliced: true,
				plates: [
					{
						// empty name -> "Plate 1"; absolute thumbnail path as Orca writes it
						name: '',
						thumbnailFile: '/tmp/orca_abc/Metadata/plate_1.png',
						objects: [{ name: 'Body &amp; Soul', volume: true, extruder: 2 }],
						prediction: 3600.4,
						filaments: { 1: 10, 2: 5.5 }
					}
				]
			})
		);
		expect(s.app).toBe('OrcaSlicer-2.3.0');
		expect(s.printer).toBe('Elegoo Centauri Carbon');
		expect(s.filaments.map((f) => f.color)).toEqual(['#FFFFFF', '#FF0000', null]);
		expect(s.filaments[2].name).toBeUndefined();
		const p = s.plates[0];
		expect(p.name).toBe('Plate 1');
		expect(p.estSeconds).toBe(3600);
		expect(p.grams).toBe(15.5);
		expect(p.thumbnail).toBeDefined();
		// the double-escaped entity from the exporter is decoded
		expect(p.objects[0]).toMatchObject({ name: 'Body & Soul', filamentIndex: 2 });
	});

	it('decodes HTML entities in plate and object names', async () => {
		const s = await parseThreeMfBytes(
			makeProjectThreeMf({
				plates: [{ name: 'PETG &amp; TPU &#8211; &quot;A&quot;', objects: [{ name: 'R&D' }] }]
			})
		);
		expect(s.plates[0].name).toBe('PETG & TPU – "A"');
		expect(s.plates[0].objects[0].name).toBe('R&D');
	});
});

describe('plain 3MF', () => {
	it('lists objects once with duplicate counts on a single plate', async () => {
		const bytes = makePlainThreeMf({
			app: 'Fusion360',
			objects: [{ id: 1, name: 'Bracket &amp; Co' }, { id: 2, name: 'Plug' }, { id: 3 }],
			items: [1, 2, 2, 2, 3]
		});
		const s = await parseThreeMf(chunks(bytes, 53));
		expect(s.kind).toBe('plain');
		expect(s.sliced).toBe(false);
		expect(s.app).toBe('Fusion360');
		expect(s.plates).toHaveLength(1);
		expect(s.plates[0].objects.map((o) => [o.name, o.count])).toEqual([
			['Bracket & Co', 1],
			['Plug', 3],
			['Object 3', 1]
		]);
		expect(s.filaments).toEqual([]);
	});

	it('scans only a bounded amount of a huge model', async () => {
		const bytes = makePlainThreeMf({
			objects: [{ id: 1, name: 'First' }],
			padBytes: 200_000
		});
		const s = await parseThreeMfBytes(bytes, { maxModelBytes: 50_000 });
		expect(s.warnings.join(' ')).toMatch(/very large/);
		expect(s.plates[0].objects[0].name).toBe('First');
	});
});

describe('limits and bad input', () => {
	it('refuses oversized config entries', async () => {
		const bytes = makeProjectThreeMf({ plates: [{ objects: [{ name: 'x' }] }] });
		await expect(parseThreeMfBytes(bytes, { maxConfigBytes: 100 })).rejects.toThrow(ThreeMfError);
	});

	it('drops oversized thumbnails with a warning and falls back to the small one', async () => {
		const bytes = makeProjectThreeMf({
			plates: [{ objects: [{ name: 'x' }] }],
			extra: { 'Metadata/plate_1.png': new Uint8Array(5000).map((_, i) => i % 251) }
		});
		const s = await parseThreeMfBytes(bytes, { maxThumbBytes: 1000 });
		expect(s.plates[0].thumbnail).toEqual(TINY_PNG); // falls back to the small one
		expect(s.warnings.join(' ')).toMatch(/oversized thumbnail/);
	});

	it('refuses zips with too many entries', async () => {
		const files: Record<string, Uint8Array> = {};
		for (let i = 0; i < 30; i++) files[`f${i}.txt`] = strToU8('x');
		await expect(parseThreeMfBytes(zipSync(files), { maxEntries: 10 })).rejects.toThrow(/too many/);
	});

	it('rejects things that are not 3MF files', async () => {
		await expect(parseThreeMfBytes(strToU8('hello world, definitely not a zip'))).rejects.toThrow(
			ThreeMfError
		);
		await expect(parseThreeMfBytes(zipSync({ 'readme.txt': strToU8('hi') }))).rejects.toThrow(
			/not a 3MF/
		);
	});
});

// The real MakeGood H-series profile (88 MB, unsliced). Never in git: point MAKEGOOD_H_3MF at it.
const realFile = process.env.MAKEGOOD_H_3MF;
describe.skipIf(!realFile || !existsSync(realFile))('real H-series file', () => {
	it('parses 21 plates quickly', async () => {
		const t0 = performance.now();
		const s = await parseThreeMfFile(realFile!);
		const ms = performance.now() - t0;
		console.log(
			`H file: ${s.plates.length} plates, ${s.filaments.length} filaments, ${s.plates.reduce((a, p) => a + p.objects.length, 0)} distinct objects, ${Math.round(ms)} ms`
		);
		expect(s.kind).toBe('project');
		expect(s.sliced).toBe(false);
		expect(s.printer).toBe('Bambu Lab H2D');
		expect(s.plates).toHaveLength(21);
		expect(s.plates[11].runsHint).toBe(4);
		expect(s.plates[19].runsHint).toBe(4);
		expect(s.plates.every((p) => p.thumbnail && p.thumbnail.length > 100)).toBe(true);
		const tires = s.plates[18].objects.find((o) => /TIRE/.test(o.name));
		expect(tires?.count).toBe(16);
		expect(ms).toBeLessThan(30_000);
	});
});
