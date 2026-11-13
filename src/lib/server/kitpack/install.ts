/**
 * Installs the kit pack of a template at start (MakeGood's converted files, CC0, plus any community part
 * the pack credits separately), so a fresh
 * install needs no upload. Runs in the background after migrations: never blocks startup,
 * never throws to the caller. Idempotent; see `docs/kit-pack.md` for the rules:
 *
 * - the pack comes from `KITPACK_DIR` (baked into the image) or is downloaded from `KITPACK_URL`
 *   (skipped with `KITPACK_DOWNLOAD=off`); the file must match the sha256 in `index.json`
 * - model, hardware, placements and print geometry are installed per item; anything an admin
 *   imported or edited is kept (model/geometry rows whose source is not `seed` or `kitpack:*`,
 *   placements with `updated_by` set)
 * - a newer pack replaces older pack data; the installed version is recorded in
 *   `template_models.source_note` / `template_print_geometry.source_note` (`kitpack:<version>`)
 *   and in a marker file `<uploads>/kitpack/<slug>.json` (no schema change)
 */
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { and, eq } from 'drizzle-orm';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import {
	kitpackDir,
	kitpackDownloadEnabled,
	kitpackUrl,
	templateHardwarePath,
	templateModelPath,
	uploadsDir
} from '../config';
import type { Db } from '../db';
import {
	templateModels,
	templatePartPlacements,
	templateParts,
	templatePrintGeometry,
	templates
} from '../db/schema';
import { encodeMesh } from '../print-geometry/mesh-format';
import { printDir } from '../print-geometry/store';
import { SEED_NOTE } from '../seed/run';
import {
	GEOMETRY_FILE,
	HARDWARE_FILE,
	KitPackError,
	MANIFEST_FILE,
	meshEntryName,
	unpackMesh,
	MODEL_FILE,
	MODEL_INFO_FILE,
	PLACEMENTS_FILE,
	compareVersions,
	decodeQMesh,
	parseIndex,
	parseManifest,
	sha256Hex,
	type IndexEntry,
	type PackIndex,
	type PackManifest
} from './format';

export const KITPACK_NOTE = 'kitpack:';
const MAX_ENTRY = 600 * 1024 * 1024;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export interface InstallOptions {
	/** Override `KITPACK_DIR`. */
	dir?: string;
	/** Override `KITPACK_URL`. */
	url?: string;
	/** Override `KITPACK_DOWNLOAD`. */
	download?: boolean;
	/** Template slugs to consider; default: every template in the database. */
	slugs?: string[];
	log?: (msg: string) => void;
}

export type InstallOutcome =
	| { slug: string; status: 'current'; version: string }
	| {
			slug: string;
			status: 'installed';
			version: string;
			model: boolean;
			hardware: boolean;
			geometry: number;
			placements: number;
			keptAdmin: number;
	  }
	| { slug: string; status: 'none' }
	| { slug: string; status: 'unavailable'; reason: string }
	| { slug: string; status: 'failed'; reason: string };

// ---- Status (read by kit-status.ts)

const active = new Map<string, string>();

/** Whether a kit pack is being installed (or downloaded) for this template right now. */
export function kitInstallState(slug: string): { installing: boolean; message: string } {
	const m = active.get(slug);
	return { installing: m !== undefined, message: m ?? '' };
}

// ---- Files

const markerPath = (slug: string) => join(uploadsDir(), 'kitpack', `${slug}.json`);
interface Marker {
	version: string;
	sha256: string;
	installedAt: string;
}
function readMarker(slug: string): Marker | null {
	try {
		const m = JSON.parse(readFileSync(markerPath(slug), 'utf8'));
		return typeof m?.version === 'string' && typeof m?.sha256 === 'string' ? m : null;
	} catch {
		return null;
	}
}

function atomicWrite(path: string, data: Uint8Array): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, data);
	renameSync(tmp, path);
}

export function appVersion(): string {
	try {
		const v = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;
		return typeof v === 'string' && /^\d+(\.\d+)*/.test(v) ? v : '0.0.0';
	} catch {
		return '0.0.0';
	}
}

/** Reads `index.json` from the pack directory; missing file means no packs. */
export function readIndex(dir: string): PackIndex {
	const p = join(dir, 'index.json');
	if (!existsSync(p)) return { format: 'tmt-kitpack-index-1', packs: [] };
	return parseIndex(JSON.parse(readFileSync(p, 'utf8')));
}

/** Newest index entry per template slug. */
export function latestEntry(index: PackIndex, slug: string): IndexEntry | undefined {
	return index.packs
		.filter((p) => p.slug === slug)
		.sort((a, b) => compareVersions(b.version, a.version))[0];
}

const tick = () => new Promise<void>((r) => setImmediate(r));

async function hashFile(path: string): Promise<{ sha256: string; size: number }> {
	const h = createHash('sha256');
	let size = 0;
	for await (const chunk of createReadStream(path)) {
		h.update(chunk as Buffer);
		size += (chunk as Buffer).length;
	}
	return { sha256: h.digest('hex'), size };
}

export function resolveUrl(pattern: string, e: IndexEntry): string {
	if (/\{(slug|version|file)\}/.test(pattern))
		return pattern
			.replaceAll('{slug}', e.slug)
			.replaceAll('{version}', e.version)
			.replaceAll('{file}', e.file);
	return `${pattern.replace(/\/+$/, '')}/${e.file}`;
}

/** Downloads (or copies, for file://) into `dest`; the caller verifies the hash. */
async function fetchTo(url: string, dest: string): Promise<void> {
	mkdirSync(dirname(dest), { recursive: true });
	const tmp = `${dest}.part-${process.pid}`;
	try {
		if (url.startsWith('file:')) {
			await pipeline(createReadStream(fileURLToPath(url)), createWriteStream(tmp));
		} else {
			const res = await fetch(url, {
				redirect: 'follow',
				signal: AbortSignal.timeout(20 * 60_000)
			});
			if (!res.ok || !res.body) throw new KitPackError(`download failed: HTTP ${res.status}`);
			await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
		}
		renameSync(tmp, dest);
	} finally {
		rmSync(tmp, { force: true });
	}
}

// ---- Install

/** Installs every available pack once. Safe to call repeatedly and concurrently. */
let running: Promise<InstallOutcome[]> | null = null;
export function installKitPacks(db: Db, opt: InstallOptions = {}): Promise<InstallOutcome[]> {
	if (running) return running;
	running = run(db, opt).finally(() => {
		running = null;
	});
	return running;
}

async function run(db: Db, opt: InstallOptions): Promise<InstallOutcome[]> {
	const log = opt.log ?? ((m: string) => console.log(`[tmt] kit pack: ${m}`));
	const dir = resolve(opt.dir ?? kitpackDir());
	const out: InstallOutcome[] = [];
	let index: PackIndex;
	try {
		index = readIndex(dir);
	} catch (e) {
		log(`cannot read ${join(dir, 'index.json')}: ${(e as Error).message}`);
		return [];
	}
	const slugs =
		opt.slugs ??
		db
			.select({ slug: templates.slug })
			.from(templates)
			.all()
			.map((t) => t.slug);
	// Decide synchronously which templates have work, so the status shows "installing" at once.
	const todo: { slug: string; entry: IndexEntry }[] = [];
	for (const slug of slugs) {
		const entry = latestEntry(index, slug);
		if (!entry) {
			out.push({ slug, status: 'none' });
			continue;
		}
		const tpl = db
			.select({ id: templates.id })
			.from(templates)
			.where(eq(templates.slug, slug))
			.get();
		if (!tpl) continue;
		const marker = readMarker(slug);
		const hasModel = db
			.select({ id: templateModels.templateId })
			.from(templateModels)
			.where(eq(templateModels.templateId, tpl.id))
			.get();
		if (marker && marker.version === entry.version && marker.sha256 === entry.sha256 && hasModel) {
			out.push({ slug, status: 'current', version: entry.version });
			continue;
		}
		active.set(slug, 'Installing MakeGood files…');
		todo.push({ slug, entry });
	}
	for (const { slug, entry } of todo) {
		try {
			out.push(await installOne(db, slug, entry, dir, opt, log));
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			log(`${slug}: install failed: ${reason}`);
			out.push({ slug, status: 'failed', reason });
		} finally {
			active.delete(slug);
		}
	}
	return out;
}

async function locatePack(
	entry: IndexEntry,
	dir: string,
	opt: InstallOptions,
	log: (m: string) => void
): Promise<{ path: string; downloaded: boolean } | { reason: string }> {
	const check = async (path: string) => {
		const h = await hashFile(path);
		if (h.sha256 !== entry.sha256)
			throw new KitPackError(
				`${entry.file}: sha256 mismatch (expected ${entry.sha256.slice(0, 12)}…, got ${h.sha256.slice(0, 12)}…); refusing to install`
			);
		if (h.size !== entry.size)
			throw new KitPackError(`${entry.file}: size differs from index.json`);
	};
	const local = join(dir, entry.file);
	if (existsSync(local) && statSync(local).isFile()) {
		await check(local);
		return { path: local, downloaded: false };
	}
	const download = opt.download ?? kitpackDownloadEnabled();
	if (!download) return { reason: `${entry.file} is not in ${dir} and downloads are off` };
	const url = resolveUrl(opt.url ?? kitpackUrl(), entry);
	const dest = join(uploadsDir(), 'kitpack', 'download', entry.file);
	active.set(entry.slug, 'Downloading MakeGood files…');
	log(`downloading ${entry.file} (${(entry.size / 1e6).toFixed(1)} MB)`);
	try {
		await fetchTo(url, dest);
	} catch (e) {
		return { reason: `download from ${url.replace(/\?.*$/, '')} failed: ${(e as Error).message}` };
	}
	try {
		await check(dest);
	} catch (e) {
		rmSync(dest, { force: true });
		throw e;
	}
	active.set(entry.slug, 'Installing MakeGood files…');
	return { path: dest, downloaded: true };
}

type Zip = Uint8Array;
function readEntry(zip: Zip, name: string): Uint8Array {
	const got = unzipSync(zip, {
		filter: (f) => {
			if (f.name !== name) return false;
			if (f.originalSize > MAX_ENTRY) throw new KitPackError(`${name} is too large`);
			return true;
		}
	})[name];
	if (!got) throw new KitPackError(`pack is missing ${name}`);
	return got;
}

async function installOne(
	db: Db,
	slug: string,
	entry: IndexEntry,
	dir: string,
	opt: InstallOptions,
	log: (m: string) => void
): Promise<InstallOutcome> {
	const located = await locatePack(entry, dir, opt, log);
	if ('reason' in located) {
		log(`${slug}: ${located.reason}`);
		return { slug, status: 'unavailable', reason: located.reason };
	}
	try {
		const zip = new Uint8Array(readFileSync(located.path));
		const manifest = parseManifest(
			JSON.parse(new TextDecoder().decode(readEntry(zip, MANIFEST_FILE)))
		);
		if (manifest.templateSlug !== slug || manifest.version !== entry.version)
			throw new KitPackError(
				`${entry.file}: manifest says ${manifest.templateSlug} ${manifest.version}`
			);
		if (compareVersions(appVersion(), manifest.appMinVersion) < 0)
			throw new KitPackError(`needs app version ${manifest.appMinVersion} or newer`);
		const verified = new Map(manifest.sources.map((s) => [s.file, s.sha256]));
		const entryOf = (name: string): Uint8Array => {
			const want = verified.get(name);
			if (!want) throw new KitPackError(`${name} is not listed in the manifest`);
			const bytes = readEntry(zip, name);
			if (sha256Hex(bytes) !== want)
				throw new KitPackError(`${name}: sha256 mismatch inside the pack`);
			return bytes;
		};
		const result = await applyPack(db, slug, manifest, entryOf, log);
		const marker: Marker = {
			version: manifest.version,
			sha256: entry.sha256,
			installedAt: new Date().toISOString()
		};
		atomicWrite(markerPath(slug), new TextEncoder().encode(JSON.stringify(marker)));
		log(
			`${slug} ${manifest.version}: model ${result.model ? 'installed' : 'kept'}, ${result.geometry} print geometry row(s), ${result.placements} placement(s)${result.keptAdmin ? `, ${result.keptAdmin} admin item(s) kept` : ''}`
		);
		return { slug, status: 'installed', version: manifest.version, ...result };
	} finally {
		if (located.downloaded) rmSync(located.path, { force: true });
	}
}

const isPack = (note: string) => note.startsWith(KITPACK_NOTE);
const noteVersion = (note: string) => note.slice(KITPACK_NOTE.length).split(':')[0];

async function applyPack(
	db: Db,
	slug: string,
	manifest: PackManifest,
	entryOf: (name: string) => Uint8Array,
	log: (m: string) => void
): Promise<{
	model: boolean;
	hardware: boolean;
	geometry: number;
	placements: number;
	keptAdmin: number;
}> {
	const tpl = db.select().from(templates).where(eq(templates.slug, slug)).get()!;
	const tid = tpl.id;
	const note = `${KITPACK_NOTE}${manifest.version}`;
	const partSlugs = new Set(
		db
			.select({ slug: templateParts.slug })
			.from(templateParts)
			.where(eq(templateParts.templateId, tid))
			.all()
			.map((p) => p.slug)
	);
	let keptAdmin = 0;

	// -- model + hardware
	const curModel = db.select().from(templateModels).where(eq(templateModels.templateId, tid)).get();
	let installModel = false;
	if (!curModel) installModel = true;
	else if (isPack(curModel.sourceNote)) {
		const c = compareVersions(manifest.version, noteVersion(curModel.sourceNote));
		installModel = c > 0 || !existsSync(templateModelPath(tid));
	} else keptAdmin++;
	let hardware = false;
	if (installModel) {
		const glb = entryOf(MODEL_FILE);
		const info = JSON.parse(new TextDecoder().decode(entryOf(MODEL_INFO_FILE))) as {
			slugs?: unknown;
		};
		const slugs = Array.isArray(info.slugs)
			? info.slugs.filter((s): s is string => typeof s === 'string')
			: [];
		atomicWrite(templateModelPath(tid), glb);
		if (manifest.contents.hardware) {
			atomicWrite(templateHardwarePath(tid), entryOf(HARDWARE_FILE));
			hardware = true;
		}
		const version = sha256Hex(glb).slice(0, 16);
		const sourceNote = `${note}: MakeGood 3D model, ${slugs.length} parts`;
		db.insert(templateModels)
			.values({
				templateId: tid,
				glbPath: templateModelPath(tid),
				version,
				size: glb.length,
				slugs,
				sourceNote,
				createdBy: null
			})
			.onConflictDoUpdate({
				target: templateModels.templateId,
				set: {
					glbPath: templateModelPath(tid),
					version,
					size: glb.length,
					slugs,
					sourceNote,
					createdBy: null,
					createdAt: new Date()
				}
			})
			.run();
		await tick();
	}

	// -- placements (only together with a model install; rows an admin edited stay)
	let placements = 0;
	if (installModel) {
		const rows = JSON.parse(new TextDecoder().decode(entryOf(PLACEMENTS_FILE))) as {
			slug: string;
			matrix: number[];
			instances: number[][];
			placed: boolean;
		}[];
		const have = new Map(
			db
				.select()
				.from(templatePartPlacements)
				.where(eq(templatePartPlacements.templateId, tid))
				.all()
				.map((r) => [r.slug, r])
		);
		db.transaction((tx) => {
			for (const p of rows) {
				if (!partSlugs.has(p.slug) || !Array.isArray(p.matrix) || p.matrix.length !== 16) continue;
				const cur = have.get(p.slug);
				const values = {
					matrix: p.matrix ?? IDENTITY,
					instances: p.instances ?? [],
					placed: !!p.placed
				};
				if (!cur) {
					tx.insert(templatePartPlacements)
						.values({ templateId: tid, slug: p.slug, ...values })
						.run();
					placements++;
				} else if (cur.updatedBy === null) {
					if (
						JSON.stringify([cur.matrix, cur.instances, cur.placed]) !==
						JSON.stringify([values.matrix, values.instances, values.placed])
					) {
						tx.update(templatePartPlacements)
							.set(values)
							.where(
								and(
									eq(templatePartPlacements.templateId, tid),
									eq(templatePartPlacements.slug, p.slug)
								)
							)
							.run();
						placements++;
					}
				} else keptAdmin++;
			}
		});
	}

	// -- print geometry
	const rows = JSON.parse(new TextDecoder().decode(entryOf(GEOMETRY_FILE))) as {
		slug: string;
		footprint: PrintFootprint;
		hull: [number, number][];
		height: number;
		tris: number;
		settings: Record<string, string>;
	}[];
	const existing = new Map(
		db
			.select()
			.from(templatePrintGeometry)
			.where(eq(templatePrintGeometry.templateId, tid))
			.all()
			.map((r) => [r.slug, r])
	);
	let geometry = 0;
	for (const r of rows) {
		if (!partSlugs.has(r.slug) || !/^[a-z0-9][a-z0-9-]*$/i.test(r.slug)) continue;
		const cur = existing.get(r.slug);
		const meshesOk = r.footprint.pieces.every(
			(pc) => pc.mesh && existsSync(join(printDir(tid), pc.mesh))
		);
		if (cur && cur.sourceNote !== SEED_NOTE) {
			if (!isPack(cur.sourceNote)) {
				keptAdmin++;
				continue;
			}
			if (compareVersions(manifest.version, noteVersion(cur.sourceNote)) <= 0 && meshesOk) continue;
		}
		const newMeshes = new Set<string>();
		mkdirSync(printDir(tid), { recursive: true });
		for (const pc of r.footprint.pieces) {
			if (!pc.mesh || !/^[A-Za-z0-9._-]+\.bin$/.test(pc.mesh))
				throw new KitPackError(`${r.slug}: invalid mesh name`);
			const q = unpackMesh(entryOf(meshEntryName(pc.mesh)));
			atomicWrite(join(printDir(tid), pc.mesh), encodeMesh(decodeQMesh(q)));
			newMeshes.add(pc.mesh);
			await tick();
		}
		// meshes of an older version of this row that the new footprint no longer uses
		for (const pc of (cur?.footprint as unknown as PrintFootprint | undefined)?.pieces ?? [])
			if (pc.mesh && !newMeshes.has(pc.mesh)) rmSync(join(printDir(tid), pc.mesh), { force: true });
		const main = r.footprint.pieces[0];
		const row = {
			footprint: r.footprint as unknown as Record<string, unknown>,
			hull: r.hull,
			height: r.height,
			tris: r.tris,
			settings: r.settings,
			meshPath: `print/${tid}/${main.mesh}`,
			sourceNote: note,
			updatedAt: new Date()
		};
		db.insert(templatePrintGeometry)
			.values({ templateId: tid, slug: r.slug, ...row })
			.onConflictDoUpdate({
				target: [templatePrintGeometry.templateId, templatePrintGeometry.slug],
				set: row
			})
			.run();
		geometry++;
	}
	if (!installModel && !geometry) log(`${slug}: nothing to install`);
	return { model: installModel, hardware, geometry, placements, keptAdmin };
}
