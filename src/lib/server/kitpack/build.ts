/**
 * Builds a kit pack from a database and uploads directory that already hold the imported kit
 * (3D model, print geometry, placements). Maintainer tool: `scripts/build-kit-pack.mjs`.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, type Zippable } from 'fflate';
import { eq } from 'drizzle-orm';
import type { PrintFootprint, PrintPiece } from '#lib/domain/print-footprint.ts';
import { templateHardwarePath, templateModelPath } from '../config';
import type { Db } from '../db';
import {
	templateModels,
	templatePartPlacements,
	templatePrintGeometry,
	templates
} from '../db/schema';
import { decodeMesh, type PrintMesh } from '../print-geometry/mesh-format';
import { printDir } from '../print-geometry/store';
import { SEED_NOTE } from '../seed/run';
import {
	CREDITS_FILE,
	DEFAULT_SCALE,
	GEOMETRY_FILE,
	HARDWARE_FILE,
	KitPackError,
	MANIFEST_FILE,
	meshEntryName,
	packMesh,
	MODEL_FILE,
	MODEL_INFO_FILE,
	PACK_FORMAT,
	PLACEMENTS_FILE,
	decodeQMesh,
	encodeQMesh,
	parseManifest,
	sha256Hex,
	type PackManifest,
	type PackSource,
	type SourceRole
} from './format';

export const LICENSE_NAME = 'CC0 1.0 (Creative Commons Public Domain)';
export const LICENSE_HOLDER = 'MakeGood';
export const LICENSE_NOTE = 'Credit: 3D model and print files by MakeGood';

/**
 * Per-object slicer settings that describe the part (walls, infill, supports, brim, painting).
 * Everything that belongs to the maintainer's machine, filament or project is dropped.
 */
const KEEP_SETTING =
	/^(wall_loops|wall_generator|sparse_infill_density|sparse_infill_pattern|top_shell_layers|bottom_shell_layers|top_shell_thickness|bottom_shell_thickness|layer_height|enable_support|support_[a-z_]+|brim_[a-z_]+|seam_position|ironing_type|detect_thin_wall|fuzzy_skin|enable_prime_tower|infill_[a-z_]+|skeleton_infill_density|skin_infill_density|raft_first_layer_expansion|reduce_infill_retraction)$/;
const DROP_SETTING =
	/filament|nozzle|printer|machine|temperature|temp$|extruder|speed|accel|jerk|bed|fan|flow|retract|pressure|cool|time|gcode|name|id$|color|colour|path|file|host|serial|ip$/i;

/** Keeps only per-object print settings (see KEEP_SETTING); returns the dropped keys too. */
export function cleanSettings(s: Record<string, string> | undefined): {
	kept: Record<string, string>;
	dropped: string[];
} {
	const kept: Record<string, string> = {};
	const dropped: string[] = [];
	for (const [k, v] of Object.entries(s ?? {})) {
		if (KEEP_SETTING.test(k) && !DROP_SETTING.test(k) && typeof v === 'string') kept[k] = v;
		else dropped.push(k);
	}
	return { kept, dropped };
}

export interface BuildOptions {
	templateSlug: string;
	version: string;
	outFile: string;
	appMinVersion?: string;
	/** Mesh quantization steps per mm (1000 = 0.001 mm). */
	scale?: number;
	/** MakerWorld page of the model, when known. */
	licenseUrl?: string;
	log?: (msg: string) => void;
}

export interface BuildResult {
	manifest: PackManifest;
	size: number;
	sha256: string;
	droppedSettings: string[];
	/** Largest position change from quantization, mm. */
	maxQuantError: number;
}

function creditsText(m: PackManifest): string {
	return `# Credits

The 3D model and print files in this kit pack are by **${m.license.holder}** (MakeGood 3D TMT,
toddler mobility trainer), released as **${m.license.name}**.${m.license.url ? `\n\nSource: ${m.license.url}` : ''}

${m.license.note}

The files were converted for TMT Build Tracker (STEP to GLB for the 3D view, slicer projects to
compact print geometry); the design is unchanged. The maker guide (PDF) is not included: get it
from MakeGood.

Kit pack ${m.templateSlug} ${m.version}, built ${m.createdAt}.
`;
}

/**
 * Throws unless `b` has the same triangles (in order, compared by corner positions: the pack
 * renumbers vertices) and the same paint as `a`; returns the largest position error (mm).
 */
export function checkRoundTrip(a: PrintMesh, b: PrintMesh, what: string): number {
	if (a.indices.length !== b.indices.length || a.positions.length !== b.positions.length)
		throw new KitPackError(`${what}: mesh size changed in the round trip`);
	const pa = a.paint ?? [];
	const pb = b.paint ?? [];
	if (pa.length !== pb.length) throw new KitPackError(`${what}: paint count changed`);
	for (let i = 0; i < pa.length; i++)
		if (pa[i].kind !== pb[i].kind || pa[i].tri !== pb[i].tri || pa[i].value !== pb[i].value)
			throw new KitPackError(`${what}: paint changed`);
	let max = 0;
	for (let i = 0; i < a.indices.length; i++)
		for (let k = 0; k < 3; k++)
			max = Math.max(
				max,
				Math.abs(a.positions[a.indices[i] * 3 + k] - b.positions[b.indices[i] * 3 + k])
			);
	return max;
}

export function buildKitPack(db: Db, opt: BuildOptions): BuildResult {
	const log = opt.log ?? (() => {});
	const scale = opt.scale ?? DEFAULT_SCALE;
	const tpl = db.select().from(templates).where(eq(templates.slug, opt.templateSlug)).get();
	if (!tpl) throw new KitPackError(`No template "${opt.templateSlug}" in the database`);
	const model = db.select().from(templateModels).where(eq(templateModels.templateId, tpl.id)).get();
	const glbPath = templateModelPath(tpl.id);
	if (!model || !existsSync(glbPath))
		throw new KitPackError('The template has no 3D model yet (import the STEP zip first)');
	const rows = db
		.select()
		.from(templatePrintGeometry)
		.where(eq(templatePrintGeometry.templateId, tpl.id))
		.all()
		.filter((r) => r.sourceNote !== SEED_NOTE);
	if (!rows.length) throw new KitPackError('The template has no imported print geometry');

	const files: Record<string, { data: Uint8Array; role: SourceRole; level: number }> = {};
	const add = (file: string, data: Uint8Array, role: SourceRole, level = 9) => {
		files[file] = { data, role, level };
	};
	const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

	add(MODEL_FILE, readFileSync(glbPath), 'model', 0);
	add(MODEL_INFO_FILE, json({ slugs: model.slugs }), 'model-info');
	const hwPath = templateHardwarePath(tpl.id);
	const hasHardware = existsSync(hwPath) && statSync(hwPath).isFile();
	if (hasHardware) add(HARDWARE_FILE, readFileSync(hwPath), 'hardware', 0);

	const placements = db
		.select()
		.from(templatePartPlacements)
		.where(eq(templatePartPlacements.templateId, tpl.id))
		.all()
		.sort((a, b) => a.slug.localeCompare(b.slug))
		.map((p) => ({ slug: p.slug, matrix: p.matrix, instances: p.instances, placed: p.placed }));
	add(PLACEMENTS_FILE, json(placements), 'placements');

	const dropped = new Set<string>();
	let meshes = 0;
	let triangles = 0;
	let paintedFaces = 0;
	let maxErr = 0;
	const geomRows = rows
		.sort((a, b) => a.slug.localeCompare(b.slug))
		.map((r) => {
			const fp = structuredClone(r.footprint) as unknown as PrintFootprint;
			for (const pc of fp.pieces as PrintPiece[]) {
				const s = cleanSettings(pc.settings);
				pc.settings = s.kept;
				s.dropped.forEach((k) => dropped.add(k));
				if (pc.partSettings) {
					const ps = cleanSettings(pc.partSettings);
					ps.dropped.forEach((k) => dropped.add(k));
					if (Object.keys(ps.kept).length) pc.partSettings = ps.kept;
					else delete pc.partSettings;
				}
				// Legacy keys of the removed 3D pose search (still in older rows) are left out of
				// new packs; readers ignore them either way.
				const legacy = pc as unknown as { orient?: unknown; sil?: { poses?: unknown } };
				delete legacy.orient;
				if (legacy.sil) delete legacy.sil.poses;
				if (!pc.mesh) throw new KitPackError(`${r.slug}: piece ${pc.name} has no mesh`);
				const src = readFileSync(join(printDir(tpl.id), pc.mesh));
				const mesh = decodeMesh(src);
				const q = encodeQMesh(mesh, scale);
				add(meshEntryName(pc.mesh), packMesh(q), 'mesh', 0);
				meshes++;
				triangles += mesh.indices.length / 3;
				paintedFaces += (mesh.paint ?? []).filter((p) => p.kind === 'supports').length;
				maxErr = Math.max(maxErr, checkRoundTrip(mesh, decodeQMesh(q), `${r.slug}/${pc.mesh}`));
			}
			return {
				slug: r.slug,
				/** Which MakeGood file this part came from (provenance only; the installer ignores it). */
				origin: r.sourceNote.split(': ')[0],
				footprint: fp,
				hull: r.hull,
				height: r.height,
				tris: r.tris,
				settings: cleanSettings(r.settings).kept
			};
		});
	add(GEOMETRY_FILE, json(geomRows), 'geometry');
	log(`${geomRows.length} parts, ${meshes} meshes, ${triangles} triangles`);

	const createdAt = new Date().toISOString();
	const manifestNoSources: Omit<PackManifest, 'sources'> = {
		format: PACK_FORMAT,
		templateSlug: opt.templateSlug,
		version: opt.version,
		createdAt,
		license: {
			name: LICENSE_NAME,
			holder: LICENSE_HOLDER,
			...(opt.licenseUrl ? { url: opt.licenseUrl } : {}),
			note: LICENSE_NOTE
		},
		contents: {
			parts: geomRows.length,
			meshes,
			triangles,
			paintedFaces,
			placements: placements.length,
			placed: placements.filter((p) => p.placed).length,
			hardware: hasHardware
		},
		appMinVersion: opt.appMinVersion ?? '0.0.1'
	};
	const credits = creditsText({ ...manifestNoSources, sources: [] });
	add(CREDITS_FILE, new TextEncoder().encode(credits), 'credits');
	const sources: PackSource[] = Object.entries(files)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([file, f]) => ({ file, sha256: sha256Hex(f.data), role: f.role }));
	const manifest = parseManifest({ ...manifestNoSources, sources });

	const mtime = new Date(createdAt);
	const zippable: Zippable = {
		[MANIFEST_FILE]: [json(manifest), { level: 9, mtime }]
	};
	for (const [file, f] of Object.entries(files))
		zippable[file] = [f.data, { level: f.level as 0 | 9, mtime }];
	const zip = zipSync(zippable);
	writeFileSync(opt.outFile, zip);
	return {
		manifest,
		size: zip.length,
		sha256: sha256Hex(zip),
		droppedSettings: [...dropped].sort(),
		maxQuantError: maxErr
	};
}
