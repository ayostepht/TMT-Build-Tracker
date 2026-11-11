/**
 * Persistence of imported print geometry: `template_print_geometry` rows plus one
 * binary mesh per piece under `uploadsDir()/print/<templateId>/` (format in
 * `mesh-format.ts`). Seed rows (numbers only, no meshes) live in the same table with
 * `source_note = 'seed'`.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import {
	GROUP_VERSION,
	type PrintFootprint,
	type SourceGroup
} from '#lib/domain/print-footprint.ts';
import { bounds, convexHull, type Pt } from '#lib/domain/geom2d.ts';
import { uploadsDir } from '../config';
import type { Db } from '../db';
import { templatePrintGeometry } from '../db/schema';
import { SEED_NOTE } from '../seed/run';
import type { ExtractedGroup, ExtractedPart } from './extract';
import { computePieceSilhouettes, SIL_VERSION } from '#lib/domain/silhouette.ts';
import { decodeMesh, encodeMesh, type PrintMesh } from './mesh-format';

export const printDir = (templateId: string) => join(uploadsDir(), 'print', templateId);

/** Relative (to uploadsDir) path of a piece's mesh. The first piece is `<slug>.bin`, the others `<slug>__<n>.bin`. */
export const meshFile = (slug: string, piece: number) =>
	piece === 0 ? `${slug}.bin` : `${slug}__${piece}.bin`;

const safeSlug = (s: string) => /^[a-z0-9][a-z0-9-]*$/i.test(s);

function removeMeshFiles(templateId: string, fp: PrintFootprint | undefined) {
	for (const p of fp?.pieces ?? [])
		if (p.mesh) rmSync(join(printDir(templateId), p.mesh), { force: true });
}

/**
 * Write extracted parts: meshes to disk, one row per slug (replacing a seed row or an
 * earlier import of that slug). The piece with the largest footprint is piece 0 and
 * fills the row's `hull`, `height`, `tris` and `settings`.
 */
export function storeExtractedParts(
	db: Db,
	templateId: string,
	parts: ExtractedPart[],
	note: string
): number {
	let n = 0;
	for (const part of parts) {
		if (!safeSlug(part.slug)) continue;
		const pieces = [...part.pieces].sort(
			(a, b) =>
				b.geometry.w * b.geometry.d - a.geometry.w * a.geometry.d || a.name.localeCompare(b.name)
		);
		const old = db
			.select({ footprint: templatePrintGeometry.footprint })
			.from(templatePrintGeometry)
			.where(
				and(
					eq(templatePrintGeometry.templateId, templateId),
					eq(templatePrintGeometry.slug, part.slug)
				)
			)
			.get();
		removeMeshFiles(templateId, old?.footprint as unknown as PrintFootprint | undefined);
		mkdirSync(printDir(templateId), { recursive: true });
		const fp: PrintFootprint = {
			slug: part.slug,
			unitsPerPlate: part.unitsPerPlate,
			pieces: pieces.map((p, i) => {
				const file = meshFile(part.slug, i);
				writeFileSync(
					join(printDir(templateId), file),
					encodeMesh({
						positions: p.geometry.positions,
						indices: p.geometry.indices,
						paint: p.geometry.paint
					})
				);
				return {
					name: p.name,
					w: p.geometry.w,
					d: p.geometry.d,
					h: p.geometry.h,
					copies: p.copies,
					hull: p.geometry.hull,
					tris: p.geometry.tris,
					mesh: file,
					settings: p.settings,
					...(Object.keys(p.partSettings ?? {}).length ? { partSettings: p.partSettings } : {}),
					...(p.geometry.paint?.length
						? {
								paint: {
									supports: p.geometry.paint.filter((e) => e.kind === 'supports').length,
									seam: p.geometry.paint.filter((e) => e.kind === 'seam').length
								}
							}
						: {}),
					...silOf({ positions: p.geometry.positions, indices: p.geometry.indices })
				};
			})
		};
		const groups = buildGroups(part.groups, fp, part.unitsPerPlate);
		if (groups.length) fp.groups = groups;
		const main = fp.pieces[0];
		const row = {
			footprint: fp as unknown as Record<string, unknown>,
			hull: main.hull ?? [],
			height: main.h,
			tris: fp.pieces.reduce((a, p) => a + (p.tris ?? 0), 0),
			settings: main.settings ?? {},
			meshPath: `print/${templateId}/${main.mesh}`,
			sourceNote: note,
			updatedAt: new Date()
		};
		db.insert(templatePrintGeometry)
			.values({ templateId, slug: part.slug, ...row })
			.onConflictDoUpdate({
				target: [templatePrintGeometry.templateId, templatePrintGeometry.slug],
				set: row
			})
			.run();
		n++;
	}
	return n;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Source groups of a footprint: piece names become indices, positions are taken relative to the
 * centre of the combined outline's box, and the outline is the pieces' silhouettes (hull when a
 * piece has none) at those positions. Returns none unless the groups hold no more objects than
 * the part's pieces call for (copies x units per plate), so a group is never used twice over.
 */
export function buildGroups(
	groups: ExtractedGroup[] | undefined,
	fp: PrintFootprint,
	unitsPerPlate: number
): SourceGroup[] {
	if (!groups?.length) return [];
	const index = new Map(fp.pieces.map((p, i) => [p.name.toLowerCase(), i]));
	const used = new Map<number, number>();
	for (const g of groups)
		for (const it of g.items) {
			const i = index.get(it.piece);
			if (i === undefined) return [];
			used.set(i, (used.get(i) ?? 0) + 1);
		}
	for (const [i, n] of used)
		if (n > Math.max(1, fp.pieces[i].copies) * Math.max(1, unitsPerPlate)) return [];
	const out: SourceGroup[] = [];
	for (const g of groups) {
		const rings: Pt[][] = [];
		for (const it of g.items) {
			const pc = fp.pieces[index.get(it.piece)!];
			const src: Pt[][] = pc.sil?.profile.rings?.length
				? pc.sil.profile.rings
				: pc.hull?.length
					? [pc.hull]
					: [
							[
								[-pc.w / 2, -pc.d / 2],
								[pc.w / 2, -pc.d / 2],
								[pc.w / 2, pc.d / 2],
								[-pc.w / 2, pc.d / 2]
							]
						];
			const a = (it.rot * Math.PI) / 180;
			const c = Math.cos(a);
			const sn = Math.sin(a);
			for (const ring of src)
				rings.push(ring.map(([x, y]) => [c * x - sn * y + it.x, sn * x + c * y + it.y] as Pt));
		}
		const b = bounds(rings.flat());
		const ox = (b.minX + b.maxX) / 2;
		const oy = (b.minY + b.maxY) / 2;
		const outline = rings.map((ring) => ring.map(([x, y]) => [r2(x - ox), r2(y - oy)] as Pt));
		out.push({
			v: GROUP_VERSION,
			plate: g.plate,
			...(g.bed ? { bed: g.bed } : {}),
			items: g.items.map((it) => ({
				piece: index.get(it.piece)!,
				x: r2(it.x - ox),
				y: r2(it.y - oy),
				rot: Math.round(it.rot * 1000) / 1000
			})),
			w: Math.ceil(b.w * 10) / 10,
			d: Math.ceil(b.d * 10) / 10,
			outline,
			hull: convexHull(outline.flat())
		});
	}
	return out;
}

/** True top-down outline of one mesh as stored (never re-oriented). */
function silOf(mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }) {
	const sil = computePieceSilhouettes(mesh);
	return sil ? { sil } : {};
}

/** Remove all imported geometry of a template (meshes and rows); seed rows stay. */
export function clearImportedGeometry(db: Db, templateId: string): number {
	const rows = db
		.select()
		.from(templatePrintGeometry)
		.where(eq(templatePrintGeometry.templateId, templateId))
		.all()
		.filter((r) => r.sourceNote !== SEED_NOTE);
	for (const r of rows) {
		removeMeshFiles(templateId, r.footprint as unknown as PrintFootprint);
		db.delete(templatePrintGeometry)
			.where(
				and(
					eq(templatePrintGeometry.templateId, templateId),
					eq(templatePrintGeometry.slug, r.slug)
				)
			)
			.run();
	}
	return rows.length;
}

/** Decoded mesh of one piece (for the 3MF exporter). Throws when the file is missing or invalid. */
export function readPieceMesh(templateId: string, meshName: string): PrintMesh {
	if (!/^[A-Za-z0-9._-]+\.bin$/.test(meshName)) throw new Error('Invalid mesh name');
	return decodeMesh(readFileSync(join(printDir(templateId), meshName)));
}

/**
 * Compute and cache the top-down silhouettes (diagram outlines) of pieces imported before
 * they existed or with an older version. Limited to `slugs` when given
 * (the diagram only needs the parts on the plates). Returns the number of pieces computed.
 */
export function ensureSilhouettes(db: Db, templateId: string, slugs?: Iterable<string>): number {
	const only = slugs ? new Set(slugs) : null;
	let n = 0;
	const rows = db
		.select()
		.from(templatePrintGeometry)
		.where(eq(templatePrintGeometry.templateId, templateId))
		.all();
	for (const r of rows) {
		if (only && !only.has(r.slug)) continue;
		const fp = r.footprint as unknown as PrintFootprint;
		if (!fp?.pieces?.length) continue;
		let changed = false;
		for (const pc of fp.pieces) {
			if (!pc.mesh || pc.sil?.v === SIL_VERSION) continue;
			try {
				const sil = computePieceSilhouettes(readPieceMesh(templateId, pc.mesh));
				if (!sil) continue;
				pc.sil = sil;
				changed = true;
				n++;
			} catch {
				// mesh file missing: nothing to compute
			}
		}
		if (changed)
			db.update(templatePrintGeometry)
				.set({ footprint: fp as unknown as Record<string, unknown> })
				.where(
					and(
						eq(templatePrintGeometry.templateId, templateId),
						eq(templatePrintGeometry.slug, r.slug)
					)
				)
				.run();
	}
	return n;
}
