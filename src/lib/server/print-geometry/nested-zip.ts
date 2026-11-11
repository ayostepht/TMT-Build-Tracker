/**
 * Unpacks the .3mf files of a bundle zip (harness and strap files) to a scratch folder, one at a
 * time through the central directory (`threemf/zipfile.ts`), so nothing is ever held in memory and
 * no buffer is sized from a number the file declares. Limits:
 * - entries in the directory: `maxEntries`, nested 3MFs: `maxFiles`;
 * - a declared size over `maxEntryBytes` is refused before the entry is read;
 * - while inflating, an entry that outgrows its declared size (or `maxEntryBytes`) is cut off;
 * - all nested files together: `maxTotalBytes`.
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { diskHasRoom } from '../config';
import { ApiError } from '../access';
import { entryChunks, readZipDirectory } from '../threemf/zipfile';

export interface NestedLimits {
	maxEntries: number;
	maxFiles: number;
	maxEntryBytes: number;
	maxTotalBytes: number;
}

export interface NestedFile {
	/** Entry name inside the bundle. */
	name: string;
	/** Where it was written. */
	path: string;
}

export async function extractNestedThreeMfs(
	zipPath: string,
	outDir: string,
	limits: NestedLimits
): Promise<NestedFile[]> {
	const dir = await readZipDirectory(zipPath, limits.maxEntries);
	const wanted = dir.filter((e) => /\.3mf$/i.test(e.name) && !e.name.endsWith('/'));
	if (wanted.length > limits.maxFiles) throw new Error('That zip holds too many 3MF files');
	// refuse on the declared sizes first: nothing has been read yet
	let declared = 0;
	for (const e of wanted) {
		if (e.usize > limits.maxEntryBytes) throw new Error(`${e.name} is too large to unpack`);
		declared += e.usize;
		if (declared > limits.maxTotalBytes) throw new Error('That zip is too large to unpack');
	}
	// the route checked the disk floor before the upload; the unpacked copies are written after it
	if (!diskHasRoom()) throw new ApiError(507, 'The server is almost out of disk space');
	await mkdir(outDir, { recursive: true });
	const out: NestedFile[] = [];
	let total = 0;
	for (const [i, e] of wanted.sort((a, b) => a.name.localeCompare(b.name)).entries()) {
		const path = join(outDir, `${i}.3mf`);
		const ws = createWriteStream(path);
		let size = 0;
		try {
			for await (const chunk of entryChunks(zipPath, e)) {
				size += chunk.length;
				total += chunk.length;
				if (size > e.usize || size > limits.maxEntryBytes)
					throw new Error(`${e.name} is larger than its zip header says`);
				if (total > limits.maxTotalBytes) throw new Error('That zip is too large to unpack');
				if (!ws.write(chunk)) await once(ws, 'drain');
			}
		} finally {
			ws.end();
			await once(ws, 'close');
		}
		out.push({ name: e.name, path });
	}
	return out;
}
