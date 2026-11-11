import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { extractNestedThreeMfs, type NestedLimits } from './nested-zip';

const LIMITS: NestedLimits = {
	maxEntries: 50,
	maxFiles: 5,
	maxEntryBytes: 1 << 20,
	maxTotalBytes: 2 << 20
};

const scratch = () => mkdtempSync(join(tmpdir(), 'tmt-nested-'));

function writeZip(files: Record<string, Uint8Array>, patch?: (b: Buffer) => void): string {
	const bytes = Buffer.from(zipSync(files, { level: 6 }));
	patch?.(bytes);
	const p = join(scratch(), 'bundle.zip');
	writeFileSync(p, bytes);
	return p;
}

/** Overwrite the declared uncompressed size of `name` in the central directory. */
function patchDeclared(name: string, usize: number) {
	return (b: Buffer) => {
		for (let i = 0; i + 46 <= b.length; i++) {
			if (b.readUInt32LE(i) !== 0x02014b50) continue;
			const nlen = b.readUInt16LE(i + 28);
			if (b.toString('latin1', i + 46, i + 46 + nlen) === name) {
				b.writeUInt32LE(usize, i + 24);
				return;
			}
		}
		throw new Error('entry not found');
	};
}

describe('extractNestedThreeMfs', () => {
	it('unpacks the .3mf entries (and only those), sorted by name', async () => {
		const zip = writeZip({
			'b.3mf': strToU8('bbb'),
			'a.3mf': strToU8('aaaa'),
			'readme.txt': strToU8('skip me')
		});
		const out = scratch();
		const got = await extractNestedThreeMfs(zip, join(out, 'x'), LIMITS);
		expect(got.map((f) => f.name)).toEqual(['a.3mf', 'b.3mf']);
		expect(readFileSync(got[0].path, 'utf8')).toBe('aaaa');
		expect(readFileSync(got[1].path, 'utf8')).toBe('bbb');
	});

	it('refuses a declared size over the cap before reading anything (about 4 GB declared)', async () => {
		const zip = writeZip({ 'a.3mf': new Uint8Array(4096) }, patchDeclared('a.3mf', 0xf0000000));
		const out = join(scratch(), 'x');
		const heap = process.memoryUsage().arrayBuffers;
		await expect(extractNestedThreeMfs(zip, out, LIMITS)).rejects.toThrow(/too large/);
		expect(existsSync(out)).toBe(false); // the scratch folder was never even created
		expect(process.memoryUsage().arrayBuffers - heap).toBeLessThan(64 << 20);
	});

	it('refuses when the declared sizes add up over the total cap', async () => {
		const files = { 'a.3mf': new Uint8Array(1000), 'b.3mf': new Uint8Array(1000) };
		const zip = writeZip(files, (b) => {
			patchDeclared('a.3mf', 1_000_000)(b);
			patchDeclared('b.3mf', 1_000_000)(b);
		});
		const out = join(scratch(), 'x');
		await expect(
			extractNestedThreeMfs(zip, out, { ...LIMITS, maxTotalBytes: 1_500_000 })
		).rejects.toThrow(/too large/);
		expect(existsSync(out)).toBe(false);
	});

	it('cuts off an entry that inflates beyond its declared size', async () => {
		// 3 MB of zeros deflate to a few KB; the header claims 1 KB
		const zip = writeZip({ 'a.3mf': new Uint8Array(3 << 20) }, patchDeclared('a.3mf', 1024));
		await expect(
			extractNestedThreeMfs(zip, join(scratch(), 'x'), { ...LIMITS, maxEntryBytes: 8 << 20 })
		).rejects.toThrow(/larger than its zip header/);
	});

	it('cuts off inflation at the cumulative cap even when the headers look small', async () => {
		const files = { 'a.3mf': new Uint8Array(900_000), 'b.3mf': new Uint8Array(900_000) };
		const zip = writeZip(files);
		await expect(
			extractNestedThreeMfs(zip, join(scratch(), 'x'), { ...LIMITS, maxTotalBytes: 1_500_000 })
		).rejects.toThrow(/too large/);
	});

	it('refuses too many entries in the directory', async () => {
		const files: Record<string, Uint8Array> = {};
		for (let i = 0; i < 20; i++) files[`f${i}.txt`] = strToU8('x');
		const zip = writeZip(files);
		const out = join(scratch(), 'x');
		await expect(extractNestedThreeMfs(zip, out, { ...LIMITS, maxEntries: 10 })).rejects.toThrow(
			/too many entries/
		);
		expect(existsSync(out)).toBe(false);
	});

	it('refuses too many nested 3MF files', async () => {
		const files: Record<string, Uint8Array> = {};
		for (let i = 0; i < 6; i++) files[`f${i}.3mf`] = strToU8('x');
		await expect(
			extractNestedThreeMfs(writeZip(files), join(scratch(), 'x'), LIMITS)
		).rejects.toThrow(/too many 3MF/);
	});
});
