/**
 * Print geometry of a template's parts from a kit author's profile 3MF: matches the
 * file's objects to parts (reusing the upload matcher), reads their meshes in the
 * author's print orientation and reduces duplicates to one mesh plus counts.
 */
import { MATCH_THRESHOLD, matchPlates, type MatchPart } from '#lib/domain/plates-match.ts';
import { deriveUnits } from '#lib/domain/print-footprint.ts';
import type { Pt } from '#lib/domain/geom2d.ts';
import { parseThreeMf } from '../threemf/index';
import {
	extractGeometry,
	readStructure,
	type Geometry,
	type ObjectSettings,
	type SourceFactory
} from './reader';

export interface ExtractedPiece {
	name: string;
	objectId: string;
	/** Copies of this piece in one unit (after `deriveUnits`). */
	copies: number;
	/** Instances seen on the busiest plate of the file. */
	onPlate: number;
	filamentIndex: number | null;
	settings: Record<string, string>;
	/** Per-part (volume) metadata of the object, e.g. support settings set on the volume. */
	partSettings?: Record<string, string>;
	geometry: Geometry;
}

export interface ExtractedPart {
	slug: string;
	pieces: ExtractedPiece[];
	unitsPerPlate: number;
	/** Plate number in the file where the part's busiest plate is, for the source note. */
	plate: number;
	/** Plate-name hint "(PRINT X4)" parsed by the plate parser, 1 when absent. */
	runsHint: number;
}

export interface ExtractReport {
	app: string | null;
	objects: number;
	matched: number;
	unmatched: string[];
	warnings: string[];
	ms: number;
}

export async function extractPartGeometry(
	open: SourceFactory,
	parts: (MatchPart & { qty: number | null })[],
	/** Name for a plain 3MF whose objects are unnamed (the nested file's name). */
	label?: string
): Promise<{ parts: ExtractedPart[]; report: ExtractReport }> {
	const t0 = Date.now();
	const summary = await parseThreeMf(open());
	if (label && summary.kind === 'plain')
		for (const pl of summary.plates)
			for (const o of pl.objects) if (/^Object \d+$/.test(o.name)) o.name = label;
	const structure = await readStructure(open);
	const matches = matchPlates(summary.plates, parts, summary.filaments);
	const qtyOf = new Map(parts.map((p) => [p.slug, p.qty]));

	// slug -> piece name -> best plate count
	interface Agg {
		name: string;
		objectId: string;
		filamentIndex: number | null;
		perPlate: Map<number, number>;
	}
	const bySlug = new Map<string, Map<string, Agg>>();
	const unmatched: string[] = [];
	let objects = 0;
	for (const pl of summary.plates)
		for (const o of pl.objects) {
			objects += o.count;
			const m = matches[`${pl.index}:${o.id}`];
			if (!m?.slug || m.confidence < (label ? 0.8 : MATCH_THRESHOLD)) {
				if (!unmatched.includes(o.name)) unmatched.push(o.name);
				continue;
			}
			const pieces = bySlug.get(m.slug) ?? new Map<string, Agg>();
			bySlug.set(m.slug, pieces);
			const key = o.name.toLowerCase();
			const agg = pieces.get(key) ?? {
				name: o.name,
				objectId: o.id,
				filamentIndex: o.filamentIndex,
				perPlate: new Map()
			};
			agg.perPlate.set(pl.index, (agg.perPlate.get(pl.index) ?? 0) + o.count);
			pieces.set(key, agg);
		}

	const requests = [...bySlug.values()].flatMap((m) =>
		[...m.values()].map((a) => ({ objectId: a.objectId }))
	);
	const { geometry, warnings } = await extractGeometry(open, structure, requests);

	const out: ExtractedPart[] = [];
	for (const [slug, pieces] of bySlug) {
		const aggs = [...pieces.values()].filter((a) => geometry.has(a.objectId));
		if (!aggs.length) continue;
		// busiest plate = where the most objects of this part sit
		const plateTotals = new Map<number, number>();
		for (const a of aggs)
			for (const [p, c] of a.perPlate) plateTotals.set(p, (plateTotals.get(p) ?? 0) + c);
		const bestPlate = [...plateTotals.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
		const counts = aggs.map((a) => a.perPlate.get(bestPlate) ?? Math.max(...a.perPlate.values()));
		const { unitsPerPlate, copies } = deriveUnits(qtyOf.get(slug) ?? null, counts);
		const plate = summary.plates.find((p) => p.index === bestPlate);
		out.push({
			slug,
			plate: bestPlate,
			unitsPerPlate,
			runsHint: plate?.runsHint ?? 1,
			pieces: aggs.map((a, i) => ({
				name: a.name,
				objectId: a.objectId,
				copies: copies[i] ?? 1,
				onPlate: counts[i],
				filamentIndex: a.filamentIndex,
				settings: pickSettings(structure.objects.get(a.objectId)),
				partSettings: structure.objects.get(a.objectId)?.partSettings ?? {},
				geometry: geometry.get(a.objectId)!
			}))
		});
	}
	// Parts that share a source file with a matched part (the two rim colors are one STEP file) use its geometry.
	const key = (f: string) => f.toLowerCase().replace(/[^a-z0-9]+/g, '');
	const have = new Map(out.map((p) => [p.slug, p]));
	for (const p of parts) {
		if (have.has(p.slug) || !/\.(step|stp|stl|3mf|obj)\b/i.test(p.sourceFile) || !key(p.sourceFile))
			continue;
		const twin = parts.find((q) => have.has(q.slug) && key(q.sourceFile) === key(p.sourceFile));
		if (twin) out.push({ ...have.get(twin.slug)!, slug: p.slug });
	}
	for (const [id, os] of structure.objects)
		if (os.extraSubtypes.length)
			warnings.push(
				`Object ${id} (${os.name}) has ${os.extraSubtypes.join(', ')} volumes; they are included in its footprint`
			);
	return {
		parts: out.sort((a, b) => a.slug.localeCompare(b.slug)),
		report: {
			app: summary.app,
			objects,
			matched: out.length,
			unmatched,
			warnings: [...summary.warnings, ...warnings],
			ms: Date.now() - t0
		}
	};
}

/** Everything the author set on the object, minus bookkeeping keys. */
function pickSettings(o: ObjectSettings | undefined): Record<string, string> {
	if (!o) return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(o.settings))
		if (k !== 'face_count' && v.length < 200) out[k] = v;
	return out;
}

export type { Pt };
