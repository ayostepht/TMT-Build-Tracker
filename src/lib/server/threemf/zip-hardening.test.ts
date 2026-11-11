import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { ThreeMfError, parseThreeMfFile } from './index';
import { BAD_ZIP_MESSAGE, MAX_CD_BYTES, readZipDirectory } from './zipfile';
import { readEntries } from '../print-geometry/reader';

const tmp = () => mkdtempSync(join(tmpdir(), 'tmt-ziph-'));
const file = (bytes: Uint8Array) => {
	const p = join(tmp(), 'f.3mf');
	writeFileSync(p, bytes);
	return p;
};

/** A local header with flag bit 3 (sizes follow the data), an unwanted name, lots of data, no central directory. */
function streamingNoDirectory(dataBytes: number): Buffer {
	const name = Buffer.from('Metadata/plate_1.gcode');
	const head = Buffer.alloc(30);
	head.writeUInt32LE(0x04034b50, 0);
	head.writeUInt16LE(20, 4);
	head.writeUInt16LE(0x08, 6); // data descriptor
	head.writeUInt16LE(0, 8); // stored
	head.writeUInt16LE(name.length, 26);
	return Buffer.concat([head, name, Buffer.alloc(dataBytes, 0x41)]);
}

/** A real zip whose end record is patched. */
function patchedEocd(patch: (b: Buffer, eocd: number) => void): string {
	const b = Buffer.from(zipSync({ 'a.txt': strToU8('hello') }));
	const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	patch(b, eocd);
	return file(b);
}

describe('files without a usable zip directory', () => {
	it('parseThreeMfFile refuses with a ThreeMfError before reading the body', async () => {
		const p = file(streamingNoDirectory(48 * 1024 * 1024));
		const before = process.memoryUsage().arrayBuffers;
		const t0 = Date.now();
		const err = await parseThreeMfFile(p).catch((e) => e);
		expect(err).toBeInstanceOf(ThreeMfError);
		expect(err.message).toBe(BAD_ZIP_MESSAGE);
		expect(Date.now() - t0).toBeLessThan(2000);
		// the 48 MB body was never read into memory
		expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(16 * 1024 * 1024);
	});

	it('readEntries on a path refuses instead of streaming', async () => {
		const p = file(streamingNoDirectory(1024));
		const open = Object.assign(
			() => {
				throw new Error('must not stream');
			},
			{ path: p }
		);
		await expect(readEntries(open as never, () => null)).rejects.toThrow(BAD_ZIP_MESSAGE);
	});
});

describe('readZipDirectory caps', () => {
	it('rejects a central directory larger than the cap without allocating it', async () => {
		const b = Buffer.from(zipSync({ 'a.txt': strToU8('hello') }));
		const pad = Buffer.alloc(MAX_CD_BYTES + 1024);
		const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
		const cdOffset = b.readUInt32LE(eocd + 16);
		const all = Buffer.concat([b.subarray(0, cdOffset), pad, b.subarray(cdOffset)]);
		const e2 = all.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
		all.writeUInt32LE(MAX_CD_BYTES + 1024, e2 + 12);
		const before = process.memoryUsage().arrayBuffers;
		await expect(readZipDirectory(file(all))).rejects.toThrow(/too large/);
		expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(16 * 1024 * 1024);
	});

	it('rejects an entry count that cannot fit in the directory', async () => {
		const p = patchedEocd((b, e) => {
			b.writeUInt16LE(5000, e + 10);
			b.writeUInt16LE(5000, e + 8);
		});
		await expect(readZipDirectory(p)).rejects.toThrow(/bad zip directory/);
	});

	it('still reads a normal zip', async () => {
		const p = file(zipSync({ 'a.txt': strToU8('hello'), 'b.txt': strToU8('x') }));
		expect((await readZipDirectory(p)).map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
	});
});
