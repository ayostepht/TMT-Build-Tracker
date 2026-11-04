/**
 * Print geometry import (site admin): reads a profile 3MF (or a zip holding 3MFs) of the
 * kit, matches its objects to the template's parts and stores footprints, hulls, meshes
 * and the author's settings. A later import replaces the slugs it contains.
 */
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { templateParts, templatePrintGeometry } from '../db/schema';
import { SEED_NOTE } from '../seed/run';
import { extractPartGeometry, type ExtractedPart, type ExtractReport } from './extract';
import { streamEntries, type SourceFactory } from './reader';
import { storeExtractedParts } from './store';

export interface ImportFileReport extends Omit<ExtractReport, 'app' | 'objects'> {
	file: string;
	parts: string[];
}
export interface ImportResult {
	imported: number;
	report: ImportFileReport[];
}

const MAX_NESTED_ZIP = 300 * 1024 * 1024;

async function entryNames(open: SourceFactory): Promise<string[]> {
	const names: string[] = [];
	await streamEntries(open(), (n) => (names.push(n), null));
	return names;
}

/**
 * Import `path` (a 3MF, or a zip containing 3MFs such as the harness and strap files) for
 * a template. `fileName` is what the admin uploaded, kept in the source note.
 */
export async function importPrintGeometry(
	db: Db,
	templateId: string,
	path: string,
	fileName: string
): Promise<ImportResult> {
	const parts = db
		.select()
		.from(templateParts)
		.where(eq(templateParts.templateId, templateId))
		.orderBy(asc(templateParts.sort))
		.all()
		.map((p) => ({
			slug: p.slug,
			name: p.name,
			sourceFile: p.sourceFile,
			notes: p.notes,
			allowedMaterials: p.allowedMaterials,
			components: p.components,
			qty: p.qty
		}));
	const open: SourceFactory = () => createReadStream(path, { highWaterMark: 1 << 20 });
	const names = await entryNames(open);
	const jobs: { label: string; open: SourceFactory; nested: boolean }[] = [];
	// A zip of stored 3MFs shows their inner entries ('3D/3dmodel.model') to a streaming reader, so
	// look at how the zip starts: a 3MF opens with its own parts, a bundle with a .3mf file.
	const first = names[0] ?? '';
	const isBundle =
		/\.3mf$/i.test(first) ||
		(!/^(\[Content_Types\]|3D\/|Metadata\/|_rels\/)/.test(first) &&
			names.some((n) => /\.3mf$/i.test(n)));
	if (!isBundle && names.includes('3D/3dmodel.model')) {
		jobs.push({ label: fileName, open, nested: false });
	} else {
		const nested = names.filter((n) => /\.3mf$/i.test(n));
		if (!nested.length) throw new Error('No 3MF file found in that upload');
		if (statSync(path).size > MAX_NESTED_ZIP) throw new Error('That zip is too large to unpack');
		const files = unzipSync(readFileSync(path), { filter: (f) => /\.3mf$/i.test(f.name) });
		for (const [name, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
			jobs.push({ label: name, open: () => [bytes], nested: true });
	}
	const report: ImportFileReport[] = [];
	let imported = 0;
	// Files of one bundle are one batch: pieces of the same part from different files add up.
	const batch = new Map<string, ExtractedPart>();
	for (const job of jobs) {
		let res;
		try {
			res = await extractPartGeometry(
				job.open,
				parts,
				job.nested
					? job.label
							.replace(/\.3mf$/i, '')
							.split('/')
							.pop()
					: undefined
			);
		} catch (e) {
			report.push({
				file: job.label,
				parts: [],
				matched: 0,
				unmatched: [],
				warnings: [`Could not read this file: ${(e as Error).message}`],
				ms: 0
			});
			continue;
		}
		if (job.nested) {
			for (const p of res.parts) {
				const cur = batch.get(p.slug);
				if (!cur) batch.set(p.slug, { ...p, pieces: [...p.pieces] });
				else
					for (const pc of p.pieces)
						if (!cur.pieces.some((x) => x.name.toLowerCase() === pc.name.toLowerCase()))
							cur.pieces.push(pc);
			}
		} else imported += storeExtractedParts(db, templateId, res.parts, fileName);
		report.push({
			file: job.label,
			parts: res.parts.map((p) => p.slug),
			matched: res.report.matched,
			unmatched: res.report.unmatched,
			warnings: res.report.warnings,
			ms: res.report.ms
		});
	}
	if (batch.size) imported += storeExtractedParts(db, templateId, [...batch.values()], fileName);
	return { imported, report };
}

export interface PrintGeometrySummaryRow {
	slug: string;
	source: string;
	w: number;
	d: number;
	h: number;
	pieces: number;
	copies: number;
	hasMesh: boolean;
	settings: Record<string, string>;
	/** Triangles with painted supports in the author's meshes. */
	paintedFaces: number;
	updatedAt: string;
}

/** Rows for the kit admin card (also tells seed rows apart from imported ones). */
export function listPrintGeometry(db: Db, templateId: string): PrintGeometrySummaryRow[] {
	return db
		.select()
		.from(templatePrintGeometry)
		.where(eq(templatePrintGeometry.templateId, templateId))
		.all()
		.map((r) => {
			const fp = r.footprint as {
				pieces?: {
					w: number;
					d: number;
					h: number;
					copies: number;
					paint?: { supports?: number };
				}[];
			};
			const pieces = fp.pieces ?? [];
			const big = pieces.reduce(
				(a, b) => (b.w * b.d > a.w * a.d ? b : a),
				pieces[0] ?? { w: 0, d: 0, h: 0, copies: 1 }
			);
			return {
				slug: r.slug,
				source: r.sourceNote === SEED_NOTE ? 'seed' : r.sourceNote,
				w: big.w,
				d: big.d,
				h: r.height,
				pieces: pieces.length,
				copies: pieces.reduce((a, p) => a + p.copies, 0),
				hasMesh: !!r.meshPath,
				settings: r.settings,
				paintedFaces: pieces.reduce((a, p) => a + (p.paint?.supports ?? 0), 0),
				updatedAt: r.updatedAt.toISOString()
			};
		})
		.sort((a, b) => a.slug.localeCompare(b.slug));
}
