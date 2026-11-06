/**
 * Large sliced projects: a 3MF with hundreds of MB of stored G-code (as Elegoo/Orca write them, with
 * data descriptors) must upload and parse with flat memory, never inflating or buffering the G-code.
 * The big file is generated with fflate's streaming writer into the gitignored `data/` directory.
 */
import { createReadStream, createWriteStream, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';
import { dirname, resolve } from 'node:path';
import { Zip, ZipPassThrough, strToU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeProjectThreeMf } from './fixtures';
import { parseThreeMfFile } from './index';
import { receiveThreeMf } from './upload';

const BIG_MB = 600;
const dir = resolve('data/scratch', `large-3mf-${Date.now()}`);
const big = resolve(dir, 'big.gcode.3mf');
const elegoo = resolve(dir, 'elegoo.gcode.3mf');
const rssMb = () => process.memoryUsage().rss / 1048576;

/** Elegoo/Orca 2.4 sliced layout: plates without model instances, objects only in slice_info.config. */
function elegooSliced(): Record<string, Uint8Array> {
	const base = unzipSync(
		makeProjectThreeMf({
			plates: [{ name: 'A', objects: [{ name: 'x' }] }],
			sliced: true
		})
	);
	const plate = (i: number, name: string, obj: string, g: number) => ({
		ms: `<plate><metadata key="plater_id" value="${i}"/><metadata key="plater_name" value="${name}"/><metadata key="gcode_file" value="Metadata/plate_${i}.gcode"/><metadata key="thumbnail_file" value="Metadata/plate_${i}.png"/></plate>`,
		si: `<plate><metadata key="index" value="${i}"/><metadata key="prediction" value="${3600 * i}"/><metadata key="weight" value="${g}"/><object identify_id="${100 + i}" name="${obj}_id_0_copy_0" skipped="false" /><object identify_id="${200 + i}" name="${obj}_id_1_copy_1" skipped="false" /><object identify_id="9" name="gone_id_0_copy_0" skipped="true" /><filament id="2" type="PETG" color="#0A005B" used_m="1" used_g="${g}"/></plate>`
	});
	const ps = [
		plate(1, 'HANDLE LEFT', '3DTMT_A1_HANDLE_LEFT_REV_A.STEP', 10),
		plate(2, 'WING', 'WING', 20)
	];
	return {
		...base,
		'Metadata/model_settings.config': strToU8(
			`<?xml version="1.0"?><config>${ps.map((p) => p.ms).join('')}</config>`
		),
		'Metadata/slice_info.config': strToU8(
			`<?xml version="1.0"?><config><header><header_item key="OrcaSlicer-Version" value="2.4.2"/></header>${ps.map((p) => p.si).join('')}</config>`
		),
		'Metadata/plate_1.png': base['Metadata/plate_1.png'],
		'Metadata/plate_2.png': base['Metadata/plate_1.png']
	};
}

/** Writes a zip the way a slicer does: stored entries after their data a descriptor. G-code first. */
async function writeZip(path: string, gcodeMb: number, entries: Record<string, Uint8Array>) {
	mkdirSync(dirname(path), { recursive: true });
	const out = createWriteStream(path);
	const done = new Promise<void>((res, rej) => (out.on('finish', res), out.on('error', rej)));
	const zip = new Zip((err, chunk, final) => {
		if (err) throw err;
		out.write(chunk);
		if (final) out.end();
	});
	if (gcodeMb) {
		const g = new ZipPassThrough('Metadata/plate_1.gcode');
		zip.add(g);
		const line = strToU8('G1 X10.123 Y20.456 E0.01234 F1800 ; wall outer\n'.repeat(23000)); // ~1 MB
		for (let i = 0; i < gcodeMb; i++) {
			g.push(line, false);
			await new Promise((r) => setImmediate(r)); // let the file stream drain
		}
		g.push(new Uint8Array(0), true);
		const md5 = new ZipPassThrough('Metadata/plate_1.gcode.md5');
		zip.add(md5);
		md5.push(strToU8('d41d8cd98f00b204e9800998ecf8427e'), true);
	}
	for (const [name, data] of Object.entries(entries)) {
		const f = new ZipPassThrough(name);
		zip.add(f);
		f.push(data, true);
	}
	zip.end();
	await done;
}

beforeAll(async () => {
	await writeZip(elegoo, 0, elegooSliced());
	await writeZip(big, BIG_MB, elegooSliced());
}, 300_000);
afterAll(() => {
	for (const f of [big, elegoo]) {
		try {
			unlinkSync(f);
		} catch {
			/* already gone */
		}
	}
});

describe('Elegoo/Orca 2.4 sliced layout', () => {
	it('takes the objects of a plate from slice_info.config and merges copies', async () => {
		const s = await parseThreeMfFile(elegoo);
		expect(s.sliced).toBe(true);
		expect(s.plates.map((p) => [p.index, p.name, p.estSeconds, p.grams])).toEqual([
			[1, 'HANDLE LEFT', 3600, 10],
			[2, 'WING', 7200, 20]
		]);
		expect(s.plates[0].objects.map((o) => [o.name, o.count])).toEqual([
			['3DTMT_A1_HANDLE_LEFT_REV_A.STEP', 2]
		]);
		expect(s.plates[0].filamentGrams).toEqual({ '2': 10 });
		expect(s.plates[0].thumbnail?.length).toBeGreaterThan(50);
	});
});

describe(`${BIG_MB} MB sliced project`, () => {
	it('parses through the central directory in flat memory', { timeout: 120_000 }, async () => {
		expect(statSync(big).size).toBeGreaterThan(BIG_MB * 1024 * 1024);
		const before = rssMb();
		let peak = before;
		const t = setInterval(() => (peak = Math.max(peak, rssMb())), 20);
		const t0 = performance.now();
		const s = await parseThreeMfFile(big);
		const ms = performance.now() - t0;
		clearInterval(t);
		expect(s.sliced).toBe(true);
		expect(s.plates).toHaveLength(2);
		expect(ms).toBeLessThan(5_000);
		expect(peak - before).toBeLessThan(150);
	});

	it(
		'uploads (streamed to disk) within MAX_3MF_MB and refuses above it',
		{ timeout: 300_000 },
		async () => {
			process.env.DATABASE_URL = resolve(dir, 'tmt.db');
			const body = () => Readable.toWeb(createReadStream(big)) as ReadableStream<Uint8Array>;
			const req = () =>
				new Request('http://x/upload', {
					method: 'POST',
					body: body(),
					headers: { 'content-type': 'application/octet-stream' },
					// @ts-expect-error node fetch option
					duplex: 'half'
				});
			const prev = process.env.MAX_3MF_MB;
			try {
				delete process.env.MAX_3MF_MB; // default 1024
				const before = rssMb();
				let peak = before;
				const t = setInterval(() => (peak = Math.max(peak, rssMb())), 20);
				const r = await receiveThreeMf(req(), 'big.gcode.3mf');
				clearInterval(t);
				expect(r.summary.sliced).toBe(true);
				expect(r.size).toBeGreaterThan(BIG_MB * 1024 * 1024);
				expect(peak - before).toBeLessThan(250);
				process.env.MAX_3MF_MB = '500';
				await expect(receiveThreeMf(req(), 'big.gcode.3mf')).rejects.toThrow(/larger than 500 MB/);
			} finally {
				if (prev === undefined) delete process.env.MAX_3MF_MB;
				else process.env.MAX_3MF_MB = prev;
			}
		}
	);
});
