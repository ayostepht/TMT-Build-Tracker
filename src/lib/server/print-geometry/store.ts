/**
 * Persistence of imported print geometry: `template_print_geometry` rows plus one
 * binary mesh per piece under `uploadsDir()/print/<templateId>/` (format in
 * `mesh-format.ts`). Seed rows (numbers only, no meshes) live in the same table with
 * `source_note = 'seed'`.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import { uploadsDir } from '../config';
import type { Db } from '../db';
import { templatePrintGeometry } from '../db/schema';
import { SEED_NOTE } from '../seed/run';
import type { ExtractedPart } from './extract';
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
					encodeMesh({ positions: p.geometry.positions, indices: p.geometry.indices })
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
					settings: p.settings
				};
			})
		};
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
