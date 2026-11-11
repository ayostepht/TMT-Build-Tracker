import { lstat, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inArray } from 'drizzle-orm';
import { importsDir } from './config.ts';
import type { Db } from './db/index.ts';
import { templateModelJobs } from './db/schema.ts';

const HOUR_MS = 60 * 60 * 1000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Files: STEP zips (`<jobKey>.zip`), print geometry uploads, and `<dest>.part` of either. */
const FILE_RE = new RegExp(`^(${UUID}\\.zip|geometry-${UUID}\\.upload)(\\.part)?$`, 'i');
/** Scratch folders of `mkdtemp(join(dir, 'nested-'))`: six random characters. */
const DIR_RE = /^nested-[A-Za-z0-9]{6}$/;

/**
 * Removes leftovers in `importsDir()` after a crash: matching temp files and `nested-*` scratch
 * folders older than an hour, except zips that a queued or running model job still points at.
 * Only names the code itself creates; symlinks are never followed or removed; never throws.
 * Returns the number of entries removed.
 */
export async function sweepImportsDir(
	db: Db,
	opts: { dir?: string; now?: number; maxAgeMs?: number } = {}
): Promise<number> {
	let removed = 0;
	try {
		const dir = resolve(opts.dir ?? importsDir());
		const now = opts.now ?? Date.now();
		const maxAge = opts.maxAgeMs ?? HOUR_MS;
		let names: string[];
		try {
			names = await readdir(dir);
		} catch {
			return 0; // no directory yet
		}
		const keep = new Set(
			db
				.select({ p: templateModelJobs.inputPath })
				.from(templateModelJobs)
				.where(inArray(templateModelJobs.status, ['queued', 'running']))
				.all()
				.map((j) => resolve(j.p))
		);
		for (const name of names) {
			const isFile = FILE_RE.test(name);
			if (!isFile && !DIR_RE.test(name)) continue;
			const path = join(dir, name);
			if (keep.has(path) || keep.has(path.replace(/\.part$/i, ''))) continue;
			try {
				const st = await lstat(path);
				if (st.isSymbolicLink()) continue;
				if (isFile ? !st.isFile() : !st.isDirectory()) continue;
				if (now - st.mtimeMs < maxAge) continue;
				await rm(path, { recursive: !isFile, force: true });
				removed++;
			} catch {
				// leave it for the next start
			}
		}
	} catch (e) {
		console.error('[tmt] imports sweep failed', e);
	}
	return removed;
}
