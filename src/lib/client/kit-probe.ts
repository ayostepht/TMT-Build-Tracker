/**
 * Kit import sniffing and byte plumbing in the browser (fflate): what is this file, what is in
 * it, and (when the plan runs) the bytes of a file or of a zip entry inside it. The decisions
 * live in `kit-import.ts`.
 */
import { unzipSync, zipSync } from 'fflate';
import {
	baseName,
	guidePdfEntries,
	is3mfName,
	isJunkEntry,
	isStepName,
	isZipName,
	looks3mf,
	type PlanItem,
	type Probe
} from '#lib/domain/kit-import.ts';

const MAX_NESTED = 300 * 1024 * 1024;

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
		if (looks3mf(entries)) return { ...base, kind: '3mf', entries };
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
