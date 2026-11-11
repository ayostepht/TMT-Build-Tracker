/**
 * Random access to the entries of a zip on disk: the central directory is read once, then each
 * wanted entry is streamed (and inflated) on its own. Nothing else of the file is touched.
 *
 * Why not fflate's `Unzip` for files: it is a push parser, and for entries written with a data
 * descriptor (Elegoo/Orca sliced projects: sizes only after the data) it keeps every chunk of an
 * entry it has not started until the next entry begins, and keeps them all. A 340 MB sliced project
 * therefore costs 340 MB of RAM and a full byte scan, although only a few KB of it are wanted.
 * Reading the central directory instead skips the G-code (`Metadata/plate_N.gcode`) and the meshes
 * for free and keeps memory flat for files of any size.
 */
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream';
import { createInflateRaw } from 'node:zlib';

export interface ZipFileEntry {
	name: string;
	method: number;
	csize: number;
	usize: number;
	offset: number;
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** Entries of the zip at `path`, in central directory order. Throws when it is not a readable zip. */
export async function readZipDirectory(
	path: string,
	maxEntries = Infinity
): Promise<ZipFileEntry[]> {
	const fh = await open(path, 'r');
	try {
		const { size } = await fh.stat();
		const tailLen = Math.min(size, 65557 + 20);
		const tail = Buffer.alloc(tailLen);
		await fh.read(tail, 0, tailLen, size - tailLen);
		let eocd = -1;
		for (let i = tailLen - 22; i >= 0; i--)
			if (tail.readUInt32LE(i) === EOCD_SIG) {
				eocd = i;
				break;
			}
		if (eocd < 0) throw new Error('no zip directory');
		let count = tail.readUInt16LE(eocd + 10);
		let cdSize = tail.readUInt32LE(eocd + 12);
		let cdOffset = tail.readUInt32LE(eocd + 16);
		if ((count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && eocd >= 20) {
			if (tail.readUInt32LE(eocd - 20) !== 0x07064b50) throw new Error('bad zip64 locator');
			const z = Buffer.alloc(56);
			await fh.read(z, 0, 56, Number(tail.readBigUInt64LE(eocd - 20 + 8)));
			if (z.readUInt32LE(0) !== 0x06064b50) throw new Error('bad zip64 record');
			count = Number(z.readBigUInt64LE(32));
			cdSize = Number(z.readBigUInt64LE(40));
			cdOffset = Number(z.readBigUInt64LE(48));
		}
		if (cdOffset + cdSize > size) throw new Error('bad zip directory');
		if (count > maxEntries) throw new Error('The zip has too many entries');
		const cd = Buffer.alloc(cdSize);
		await fh.read(cd, 0, cdSize, cdOffset);
		const out: ZipFileEntry[] = [];
		let o = 0;
		for (let n = 0; n < count; n++) {
			if (o + 46 > cd.length || cd.readUInt32LE(o) !== CD_SIG) throw new Error('bad zip directory');
			const flags = cd.readUInt16LE(o + 8);
			const method = cd.readUInt16LE(o + 10);
			let csize = cd.readUInt32LE(o + 20);
			let usize = cd.readUInt32LE(o + 24);
			const nlen = cd.readUInt16LE(o + 28);
			const elen = cd.readUInt16LE(o + 30);
			const clen = cd.readUInt16LE(o + 32);
			let offset = cd.readUInt32LE(o + 42);
			const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', o + 46, o + 46 + nlen);
			let e = o + 46 + nlen;
			const eEnd = e + elen;
			while (e + 4 <= eEnd) {
				const id = cd.readUInt16LE(e);
				const sz = cd.readUInt16LE(e + 2);
				if (id === 1) {
					let q = e + 4;
					if (usize === 0xffffffff) {
						usize = Number(cd.readBigUInt64LE(q));
						q += 8;
					}
					if (csize === 0xffffffff) {
						csize = Number(cd.readBigUInt64LE(q));
						q += 8;
					}
					if (offset === 0xffffffff) offset = Number(cd.readBigUInt64LE(q));
				}
				e += 4 + sz;
			}
			out.push({ name, method, csize, usize, offset });
			o += 46 + nlen + elen + clen;
		}
		return out;
	} finally {
		await fh.close();
	}
}

/** The inflated bytes of one entry as a stream of chunks. Stop early by breaking the loop. */
export async function* entryChunks(path: string, e: ZipFileEntry): AsyncGenerator<Uint8Array> {
	if (e.csize === 0) return;
	if (e.method !== 0 && e.method !== 8) throw new Error(`unsupported compression in ${e.name}`);
	const fh = await open(path, 'r');
	let start: number;
	try {
		const head = Buffer.alloc(30);
		await fh.read(head, 0, 30, e.offset);
		if (head.readUInt32LE(0) !== LOCAL_SIG) throw new Error(`bad local header for ${e.name}`);
		start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
	} finally {
		await fh.close();
	}
	const src = createReadStream(path, { start, end: start + e.csize - 1, highWaterMark: 1 << 20 });
	if (e.method === 0) {
		yield* src;
		return;
	}
	const inflate = createInflateRaw();
	pipeline(src, inflate, () => {});
	try {
		yield* inflate;
	} finally {
		inflate.destroy();
		src.destroy();
	}
}
