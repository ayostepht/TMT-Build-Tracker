/**
 * Kit import sniffing and byte plumbing in the browser (fflate): what is this file, what is in
 * it, and (when the plan runs) the bytes of a file or of a zip entry inside it. The decisions
 * live in `kit-import.ts`.
 */
import { inflateSync, strFromU8, unzipSync, zipSync } from 'fflate';
import {
	baseName,
	guidePdfEntries,
	is3mfName,
	isJunkEntry,
	isStepName,
	SLICE_INFO_ENTRY,
	slicedPlates,
	isZipName,
	looks3mf,
	type PlanItem,
	type Probe
} from '#lib/domain/kit-import.ts';

const MAX_NESTED = 300 * 1024 * 1024;
/** Files up to this size are read whole; bigger ones (sliced projects) are opened through their central directory only. */
export const BIG_FILE = 48 * 1024 * 1024;
/** Largest entry the browser inflates from a big zip (configs, thumbnails, the guide PDF, nested 3MFs). */
const MAX_ENTRY = MAX_NESTED;

const isZip = (b: Uint8Array) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;
const isPdf = (b: Uint8Array) =>
	b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

/** Entry names of a zip without inflating anything. */
export function zipEntryNames(bytes: Uint8Array): string[] {
	const names: string[] = [];
	unzipSync(bytes, {
		filter: (f) => {
			names.push(f.name);
			return false;
		}
	});
	return names;
}

/** One entry's bytes (undefined when absent). */
export function zipEntry(bytes: Uint8Array, entry: string): Uint8Array | undefined {
	return unzipSync(bytes, { filter: (f) => f.name === entry })[entry];
}

// ---- zips read through Blob.slice (never the whole file) --------------------------------

export interface BlobZipEntry {
	name: string;
	method: number;
	csize: number;
	usize: number;
	offset: number;
}
export interface BlobZip {
	entries: BlobZipEntry[];
	/** One entry's inflated bytes; undefined when absent or over `maxBytes`. */
	read(name: string, maxBytes?: number): Promise<Uint8Array | undefined>;
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);
const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true));
const bytesOf = async (blob: Blob, start: number, end: number) =>
	new Uint8Array(await blob.slice(start, end).arrayBuffer());

/**
 * Opens a zip by reading its end-of-central-directory record and the central directory only
 * (a few hundred KB for a 1 GB sliced project); entries are read one at a time on request.
 * Handles zip64. Throws when the blob is not a readable zip.
 */
export async function openBlobZip(blob: Blob): Promise<BlobZip> {
	const tailLen = Math.min(blob.size, 65557 + 20);
	const tailStart = blob.size - tailLen;
	const tail = await bytesOf(blob, tailStart, blob.size);
	const tv = new DataView(tail.buffer);
	let eocd = -1;
	for (let i = tail.length - 22; i >= 0; i--)
		if (u32(tv, i) === 0x06054b50) {
			eocd = i;
			break;
		}
	if (eocd < 0) throw new Error('not a zip file');
	let count = u16(tv, eocd + 10);
	let cdSize = u32(tv, eocd + 12);
	let cdOffset = u32(tv, eocd + 16);
	if ((count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && eocd >= 20) {
		if (u32(tv, eocd - 20) !== 0x07064b50) throw new Error('bad zip64 locator');
		const z64Offset = u64(tv, eocd - 20 + 8);
		const z = new DataView((await bytesOf(blob, z64Offset, z64Offset + 56)).buffer);
		if (u32(z, 0) !== 0x06064b50) throw new Error('bad zip64 record');
		count = u64(z, 32);
		cdSize = u64(z, 40);
		cdOffset = u64(z, 48);
	}
	const cd = await bytesOf(blob, cdOffset, cdOffset + cdSize);
	const v = new DataView(cd.buffer);
	const entries: BlobZipEntry[] = [];
	const dec = new TextDecoder();
	for (let o = 0, n = 0; n < count && o + 46 <= cd.length; n++) {
		if (u32(v, o) !== 0x02014b50) throw new Error('bad central directory');
		const method = u16(v, o + 10);
		let csize = u32(v, o + 20);
		let usize = u32(v, o + 24);
		const nlen = u16(v, o + 28);
		const elen = u16(v, o + 30);
		const clen = u16(v, o + 32);
		let offset = u32(v, o + 42);
		const name = dec.decode(cd.subarray(o + 46, o + 46 + nlen));
		// zip64 extra field: only the fields set to 0xFFFFFFFF are present, in this order
		let e = o + 46 + nlen;
		const eEnd = e + elen;
		while (e + 4 <= eEnd) {
			const id = u16(v, e);
			const sz = u16(v, e + 2);
			if (id === 0x0001) {
				let q = e + 4;
				if (usize === 0xffffffff) {
					usize = u64(v, q);
					q += 8;
				}
				if (csize === 0xffffffff) {
					csize = u64(v, q);
					q += 8;
				}
				if (offset === 0xffffffff) offset = u64(v, q);
			}
			e += 4 + sz;
		}
		entries.push({ name, method, csize, usize, offset });
		o += 46 + nlen + elen + clen;
	}
	return {
		entries,
		async read(name, maxBytes = MAX_ENTRY) {
			const ent = entries.find((x) => x.name === name);
			if (!ent || ent.usize > maxBytes) return undefined;
			const head = new DataView((await bytesOf(blob, ent.offset, ent.offset + 30)).buffer);
			if (u32(head, 0) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
			const start = ent.offset + 30 + u16(head, 26) + u16(head, 28);
			const data = await bytesOf(blob, start, start + ent.csize);
			if (ent.method === 0) return data;
			if (ent.method === 8) return inflateSync(data, { out: new Uint8Array(ent.usize) });
			throw new Error(`unsupported compression for ${name}`);
		}
	};
}

const sliceInfoText = (bytes: Uint8Array | undefined) => (bytes ? strFromU8(bytes) : null);

/** Probe of a big file without reading it whole: zips through their central directory, other types by their head. */
export async function probeBlob(file: Blob & { name: string }): Promise<Probe> {
	const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
	const base: Probe = { name: file.name, size: file.size, kind: 'unknown' };
	if (!isZip(head)) {
		// PDFs and STEP text this big are rare; read them whole.
		return probeBytes(file.name, new Uint8Array(await file.arrayBuffer()));
	}
	let zip: BlobZip;
	try {
		zip = await openBlobZip(file);
	} catch {
		return base;
	}
	const entries = zip.entries.map((e) => e.name);
	if (looks3mf(entries)) {
		const probe: Probe = { ...base, kind: '3mf', entries };
		const sliced = slicedPlates(entries, sliceInfoText(await zip.read(SLICE_INFO_ENTRY, 64 << 20)));
		if (sliced) probe.sliced = { plates: sliced };
		return probe;
	}
	const probe: Probe = { ...base, kind: 'zip', entries };
	const children: Probe[] = [];
	for (const e of zip.entries.filter(
		(e) => !isJunkEntry(e.name) && (isZipName(e.name) || is3mfName(e.name))
	)) {
		try {
			const data = await zip.read(e.name, MAX_NESTED);
			if (data) children.push(probeBytes(baseName(e.name), data, e.name, 1));
		} catch {
			/* unreadable entry: left out */
		}
	}
	if (children.length) probe.children = children;
	return probe;
}

/** The guide PDF of a big 3MF/zip, reading only the entries needed. */
export async function findGuidePdfInBlob(
	file: Blob
): Promise<{ bytes: Uint8Array; name: string } | null> {
	let zip: BlobZip;
	try {
		zip = await openBlobZip(file);
	} catch {
		return null;
	}
	const names = zip.entries.map((e) => e.name).filter((n) => !isJunkEntry(n));
	const direct = guidePdfEntries(names)[0] ?? names.find((n) => /\.pdf$/i.test(n));
	if (direct) {
		const data = await zip.read(direct);
		if (data && isPdf(data)) return { bytes: data, name: baseName(direct) };
	}
	for (const n of names.filter(is3mfName)) {
		const inner = await zip.read(n, MAX_NESTED);
		const found = inner && findGuidePdf(inner, 1);
		if (found) return found;
	}
	return null;
}

/** Sniff bytes into a `Probe`; zips are opened one level (their nested zips and 3MFs, shallowly). */
export function probeBytes(name: string, bytes: Uint8Array, entry?: string, depth = 0): Probe {
	const base: Probe = { name, entry, size: bytes.length, kind: 'unknown' };
	if (isPdf(bytes)) return { ...base, kind: 'pdf' };
	if (isZip(bytes)) {
		let entries: string[];
		try {
			entries = zipEntryNames(bytes);
		} catch {
			return base;
		}
		if (looks3mf(entries)) {
			const probe: Probe = { ...base, kind: '3mf', entries };
			let info: string | null = null;
			try {
				const si = entries.includes(SLICE_INFO_ENTRY)
					? zipEntry(bytes, SLICE_INFO_ENTRY)
					: undefined;
				info = sliceInfoText(si);
			} catch {
				/* unreadable: judge by the G-code entries */
			}
			const sliced = slicedPlates(entries, info);
			if (sliced) probe.sliced = { plates: sliced };
			return probe;
		}
		const probe: Probe = { ...base, kind: 'zip', entries };
		if (depth === 0) {
			const children: Probe[] = [];
			for (const e of entries.filter((e) => !isJunkEntry(e) && (isZipName(e) || is3mfName(e)))) {
				try {
					const data = zipEntry(bytes, e);
					if (data && data.length <= MAX_NESTED)
						children.push(probeBytes(baseName(e), data, e, depth + 1));
				} catch {
					/* unreadable entry: left out, the server reports it if it matters */
				}
			}
			if (children.length) probe.children = children;
		}
		return probe;
	}
	// STEP is text; trust the extension, but only if it looks like ISO-10303 text.
	if (isStepName(name)) {
		const head = new TextDecoder().decode(bytes.subarray(0, 200));
		if (/ISO-10303/i.test(head)) return { ...base, kind: 'step' };
	}
	return base;
}

export async function probeFile(file: File): Promise<Probe> {
	if (file.size > BIG_FILE) return probeBlob(file);
	return probeBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}

/** Bytes of a plan item: the dropped file itself, or the nested zip inside it. */
export async function itemBytes(file: File, item: PlanItem): Promise<Uint8Array> {
	let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
	for (const entry of item.entryPath) {
		const next = zipEntry(bytes, entry);
		if (!next) throw new Error(`${entry} is no longer readable`);
		bytes = next;
	}
	return bytes;
}

/** The guide PDF in a PDF, a 3MF (under Auxiliaries/) or a zip of 3MFs/PDFs. */
export function findGuidePdf(
	bytes: Uint8Array,
	depth = 0
): { bytes: Uint8Array; name: string } | null {
	if (isPdf(bytes)) return { bytes, name: 'guide.pdf' };
	if (!isZip(bytes)) return null;
	const names = zipEntryNames(bytes).filter((n) => !isJunkEntry(n));
	const direct = guidePdfEntries(names)[0] ?? names.find((n) => /\.pdf$/i.test(n));
	if (direct) {
		const data = zipEntry(bytes, direct);
		if (data && isPdf(data)) return { bytes: data, name: baseName(direct) };
	}
	if (depth === 0)
		for (const n of names.filter(is3mfName)) {
			const inner = zipEntry(bytes, n);
			const found = inner && findGuidePdf(inner, 1);
			if (found) return found;
		}
	return null;
}

/**
 * One zip for the model endpoint out of every STEP source (loose files and zips): STEP entries
 * keep their folder path, loose files sit at the root, a name already taken is skipped. Stored
 * without recompression (STEP zips are mostly compressed already and the server inflates it).
 */
export function mergeStepSources(sources: { name: string; bytes: Uint8Array; loose: boolean }[]): {
	zip: Uint8Array;
	files: number;
	skipped: string[];
} {
	const out: Record<string, Uint8Array> = {};
	const skipped: string[] = [];
	const put = (path: string, data: Uint8Array) => {
		if (path in out) skipped.push(path);
		else out[path] = data;
	};
	for (const s of sources) {
		if (s.loose) put(s.name, s.bytes);
		else {
			const files = unzipSync(s.bytes, { filter: (f) => isStepName(f.name) });
			for (const [p, data] of Object.entries(files)) put(p, data);
		}
	}
	return { zip: zipSync(out, { level: 0 }), files: Object.keys(out).length, skipped };
}
