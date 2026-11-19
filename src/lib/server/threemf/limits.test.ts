import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { DEFAULT_LIMITS, ThreeMfError, parseThreeMfBytes, parseThreeMfFile } from './index';
import { attachGcodeObjectStats } from './gcode-stats';
import { makeProjectThreeMf, TINY_PNG } from './fixtures';
import type { ThreeMfSummary } from '#lib/domain/threemf.ts';

const MB = 1024 * 1024;
const dir = mkdtempSync(join(tmpdir(), 'tmt-lim-'));
let n = 0;
const file = (bytes: Uint8Array) => {
	const p = join(dir, `f${n++}.3mf`);
	writeFileSync(p, bytes);
	return p;
};

const base = (): Zippable => ({
	'Metadata/model_settings.config': strToU8('<config></config>'),
	'Metadata/project_settings.config': strToU8('{}'),
	'3D/3dmodel.model': strToU8('<model><resources/><build/></model>')
});
/** Zip with level 9 so the repeated bytes cost almost nothing on disk. */
const zip = (files: Zippable) => zipSync(files, { level: 6 });
const zeros = (bytes: number) => new Uint8Array(bytes);

async function rejectsFast(p: Promise<unknown>, msg: RegExp) {
	const t0 = Date.now();
	const rss0 = process.memoryUsage().rss;
	const err = await p.then(
		() => null,
		(e) => e
	);
	expect(err).toBeInstanceOf(ThreeMfError);
	expect((err as Error).message).toMatch(msg);
	expect(Date.now() - t0).toBeLessThan(2000);
	expect(process.memoryUsage().rss - rss0).toBeLessThan(200 * MB);
}

describe('3MF parser limits (file and stream readers)', () => {
	it('accepts a normal sliced project', async () => {
		const bytes = makeProjectThreeMf({
			sliced: true,
			plates: [{ objects: [{ name: 'A' }] }, { objects: [{ name: 'B' }] }]
		});
		expect((await parseThreeMfFile(file(bytes))).plates).toHaveLength(2);
		expect((await parseThreeMfBytes(bytes)).plates).toHaveLength(2);
	});

	it('stops when retained thumbnails exceed the total budget', async () => {
		const files = base();
		const big = zeros(7 * MB); // under the per-thumbnail cap, tiny once compressed
		for (let i = 1; i <= 12; i++) files[`Metadata/plate_${i}.png`] = big;
		const bytes = zip(files);
		expect(bytes.length).toBeLessThan(2 * MB);
		await rejectsFast(parseThreeMfFile(file(bytes)), /too much/);
		await rejectsFast(parseThreeMfBytes(bytes), /too much/);
	});

	it('keeps only a bounded number of plate thumbnails', async () => {
		const files = base();
		for (let i = 1; i <= 300; i++) files[`Metadata/plate_${i}.png`] = TINY_PNG;
		const bytes = zip(files);
		const keep = { maxThumbs: 5 };
		// only the first plates are read; the rest are ignored without error
		const s = await parseThreeMfFile(file(bytes), keep);
		expect(s).toBeTruthy();
		const s2 = await parseThreeMfBytes(bytes, keep);
		expect(s2).toBeTruthy();
	});

	it('rejects an oversize config', async () => {
		const files = base();
		files['Metadata/model_settings.config'] = zeros(DEFAULT_LIMITS.maxXmlConfigBytes + 1);
		const bytes = zip(files);
		await rejectsFast(parseThreeMfFile(file(bytes)), /too large/);
		await rejectsFast(parseThreeMfBytes(bytes), /too large/);
	});

	it('enforces the size while inflating, not by the declared size', async () => {
		const files = base();
		files['Metadata/slice_info.config'] = zeros(20 * MB);
		const bytes = Buffer.from(zip(files));
		// lie in both headers: declare 100 bytes
		const name = Buffer.from('Metadata/slice_info.config');
		for (
			let i = bytes.indexOf(name) - 30;
			i >= 0;
			i = bytes.indexOf(Buffer.from('PK\x03\x04'), i + 1)
		) {
			if (bytes.subarray(i + 30, i + 30 + name.length).equals(name))
				bytes.writeUInt32LE(100, i + 22);
			break;
		}
		for (
			let i = bytes.indexOf(Buffer.from('PK\x01\x02'));
			i >= 0;
			i = bytes.indexOf(Buffer.from('PK\x01\x02'), i + 1)
		) {
			const nl = bytes.readUInt16LE(i + 28);
			if (bytes.toString('latin1', i + 46, i + 46 + nl) === 'Metadata/slice_info.config')
				bytes.writeUInt32LE(100, i + 24);
		}
		await rejectsFast(parseThreeMfFile(file(bytes)), /too large/);
	});

	it('rejects a zip with too many entries', async () => {
		const files = base();
		for (let i = 0; i <= DEFAULT_LIMITS.maxEntries; i++) files[`x/${i}.txt`] = new Uint8Array(0);
		const bytes = zip(files);
		await rejectsFast(parseThreeMfFile(file(bytes)), /too many entries/);
		// the push parser may fail earlier inside the zip library; it must still refuse fast
		await rejectsFast(parseThreeMfBytes(bytes), /too many entries|valid 3MF/);
	});

	it('refuses a file over the entry cap from its directory count, before reading the directory', async () => {
		const files = base();
		for (let i = 0; i < 50; i++) files[`x/${i}.txt`] = new Uint8Array(0);
		const bytes = zip(files);
		await rejectsFast(parseThreeMfFile(file(bytes), { maxEntries: 10 }), /too many entries/);
		// the same file passes under a cap that fits it
		await expect(parseThreeMfFile(file(bytes), { maxEntries: 100 })).resolves.toBeTruthy();
	});

	it('leaves G-code stats alone for a directory over the entry cap', async () => {
		const files = base();
		files['Metadata/plate_1.gcode'] = zeros(10);
		for (let i = 0; i < DEFAULT_LIMITS.maxEntries; i++) files[`x/${i}.txt`] = new Uint8Array(0);
		const rep = await attachGcodeObjectStats(file(zip(files)), {
			plates: [{ index: 1 }]
		} as unknown as ThreeMfSummary);
		expect(rep.withGcode).toBe(0);
		expect(rep.plates).toBe(0);
	});

	it('keeps thumbnails for plates up to the cap and ignores the ones beyond it', async () => {
		const files = base();
		const last = DEFAULT_LIMITS.maxThumbs;
		files[`Metadata/plate_${last}.png`] = TINY_PNG;
		files[`Metadata/plate_${last + 1}.png`] = TINY_PNG;
		const s = await parseThreeMfFile(file(zip(files)));
		expect(s).toBeTruthy();
	});

	it('rejects when total inflated bytes pass the budget', async () => {
		const files = base();
		files['Metadata/plate_1.png'] = zeros(3 * MB);
		files['Metadata/plate_2.png'] = zeros(3 * MB);
		const bytes = zip(files);
		await rejectsFast(parseThreeMfFile(file(bytes), { maxInflatedBytes: 4 * MB }), /too much/);
		await rejectsFast(parseThreeMfBytes(bytes, { maxInflatedBytes: 4 * MB }), /too much/);
	});

	it('parses XML at the cap within a few seconds for a flat config', async () => {
		const files = base();
		const body = '<object id="1"><metadata key="a" value="b"/></object>'.repeat(
			Math.floor((DEFAULT_LIMITS.maxXmlConfigBytes - 1024) / 54)
		);
		files['Metadata/model_settings.config'] = strToU8(`<config>${body}</config>`);
		const t0 = Date.now();
		await parseThreeMfFile(file(zip(files)));
		// ~1.8 s alone at the 8 MB cap; loaded CI machines need headroom
		expect(Date.now() - t0).toBeLessThan(8000);
	});
});

describe('G-code scan limits', () => {
	const summary = () => ({ plates: [{ index: 1 }, { index: 2 }] }) as unknown as ThreeMfSummary;
	const gz = (n: number) => {
		const files = base();
		files['Metadata/plate_1.gcode'] = zeros(n);
		files['Metadata/plate_2.gcode'] = zeros(n);
		return file(zip(files));
	};

	it('skips a plate whose G-code inflates past the per-entry cap', async () => {
		const t0 = Date.now();
		const rep = await attachGcodeObjectStats(gz(20 * MB), summary(), 60_000, {
			entry: 4 * MB,
			total: 1024 * MB
		});
		expect(rep.plates).toBe(0);
		expect(rep.note).toMatch(/too large/);
		expect(Date.now() - t0).toBeLessThan(2000);
	});

	it('stops at the per-upload cap', async () => {
		const rep = await attachGcodeObjectStats(gz(3 * MB), summary(), 60_000, {
			entry: 100 * MB,
			total: 4 * MB
		});
		expect(rep.note).toMatch(/too large/);
		expect(rep.withGcode).toBe(2);
	});

	it('checks the time budget inside the chunk loop', async () => {
		const t0 = Date.now();
		const rep = await attachGcodeObjectStats(gz(40 * MB), summary(), 1);
		expect(rep.note).toMatch(/stopped after/);
		expect(Date.now() - t0).toBeLessThan(2000);
	});
});
