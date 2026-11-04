/**
 * Print geometry of a template's parts from a kit author's profile 3MF: matches the
 * file's objects to parts (reusing the upload matcher), reads their meshes in the
 * author's print orientation and reduces duplicates to one mesh plus counts.
 */
import { MATCH_THRESHOLD, matchPlates, type MatchPart } from '#lib/domain/plates-match.ts';
import { deriveUnits } from '#lib/domain/print-footprint.ts';
import type { Pt } from '#lib/domain/geom2d.ts';
import type { ThreeMfObject, ThreeMfPlate } from '#lib/domain/threemf.ts';
import { parseThreeMf } from '../threemf/index';
import {
	extractGeometry,
	readStructure,
	type Geometry,
	type InstanceRef,
	type ObjectSettings,
	type SourceFactory,
	type Structure
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

/** One printed object of a source plate: which piece, and where its stored mesh sits on that plate (file coordinates). */
export interface ExtractedGroupItem {
	/** Lower-case piece name. */
	piece: string;
	x: number;
	y: number;
	/** Degrees counter-clockwise about z, applied to the stored (normalised) mesh. */
	rot: number;
}
/** The objects of one part that share a plate of the source file. */
export interface ExtractedGroup {
	/** Plate number in the source file. */
	plate: number;
	/** Bed of the source profile (from `printable_area`), when it says. */
	bed?: { x: number; y: number };
	items: ExtractedGroupItem[];
}

export interface ExtractedPart {
	slug: string;
	pieces: ExtractedPiece[];
	/** Pieces laid out as in the source file, one group per source plate with at least two objects. */
	groups?: ExtractedGroup[];
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
		/** Build items of the piece per plate; null when the file does not say which objects they are. */
		refs: Map<number, InstanceRef[] | null>;
	}
	const used = new Map<string, number>(); // object id -> items handed out so far
	const instances = (pl: ThreeMfPlate, o: ThreeMfObject): InstanceRef[] | null => {
		let ids: string[];
		if (summary.kind === 'project') {
			ids = (structure.plates.get(pl.index) ?? []).filter((id) => {
				const os = structure.objects.get(id);
				if (!os || os.name !== o.name) return false;
				const ex = Number(os.settings.extruder);
				return !Number.isFinite(ex) || o.filamentIndex === null || ex === o.filamentIndex;
			});
		} else ids = structure.model.items.filter((i) => i.objectId === o.id).map((i) => i.objectId);
		if (ids.length !== o.count) return null;
		return ids.map((objectId) => {
			const index = used.get(objectId) ?? 0;
			used.set(objectId, index + 1);
			return { objectId, index };
		});
	};
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
				perPlate: new Map(),
				refs: new Map()
			};
			agg.perPlate.set(pl.index, (agg.perPlate.get(pl.index) ?? 0) + o.count);
			const refs = instances(pl, o);
			const had = agg.refs.get(pl.index);
			agg.refs.set(pl.index, refs === null || had === null ? null : [...(had ?? []), ...refs]);
			pieces.set(key, agg);
		}

	// Objects that share a plate with another object of their part are measured against each other's
	// copies, so the part's layout on the plate can be kept (see `ExtractedPart.groups`).
	const crowded = (m: Map<string, Agg>) => {
		const total = new Map<number, number>();
		for (const a of m.values())
			for (const [p, c] of a.perPlate) total.set(p, (total.get(p) ?? 0) + c);
		return [...total.values()].some((c) => c >= 2);
	};
	const requests = [...bySlug.values()].flatMap((m) =>
		[...m.values()].map((a) => {
			const refs = [...a.refs.values()].flatMap((r) => r ?? []);
			// an empty list still asks for the object's own placement
			return crowded(m)
				? {
						objectId: a.objectId,
						copies: refs.filter((r) => !(r.objectId === a.objectId && r.index === 0))
					}
				: { objectId: a.objectId };
		})
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
		const groups = crowded(pieces)
			? sourceGroups(aggs, counts, bestPlate, geometry, structure.bed)
			: undefined;
		out.push({
			slug,
			...(groups?.length ? { groups } : {}),
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

/**
 * The part's objects as the source file lays them out: one group per source plate that holds at
 * least two of them. Only when the plates used account for exactly the piece counts the part is
 * made of (a part printed on several plates keeps the busiest one) and every object could be
 * measured; otherwise there is no group and the pieces are packed one by one.
 */
function sourceGroups(
	aggs: {
		name: string;
		objectId: string;
		perPlate: Map<number, number>;
		refs: Map<number, InstanceRef[] | null>;
	}[],
	counts: number[],
	bestPlate: number,
	geometry: Map<string, Geometry>,
	bed: Structure['bed']
): ExtractedGroup[] | undefined {
	// the busiest plate, plus the plate of any piece that is not on it
	const plates = new Set([bestPlate]);
	aggs.forEach((a) => {
		if (a.perPlate.has(bestPlate)) return;
		const best = [...a.perPlate.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
		if (best) plates.add(best[0]);
	});
	for (let i = 0; i < aggs.length; i++) {
		let n = 0;
		for (const p of plates) n += aggs[i].perPlate.get(p) ?? 0;
		if (n !== counts[i]) return undefined;
	}
	const groups: ExtractedGroup[] = [];
	for (const plate of [...plates].sort((a, b) => a - b)) {
		const items: ExtractedGroupItem[] = [];
		for (const a of aggs) {
			const refs = a.refs.get(plate);
			if (refs === undefined) continue;
			if (refs === null) return undefined;
			const placements = geometry.get(a.objectId)?.placements;
			for (const r of refs) {
				const pl = placements?.find((q) => q.objectId === r.objectId && q.index === r.index);
				if (!pl?.ok) return undefined;
				items.push({ piece: a.name.toLowerCase(), x: pl.x, y: pl.y, rot: pl.rot });
			}
		}
		if (items.length >= 2) groups.push({ plate, ...(bed ? { bed } : {}), items });
	}
	return groups;
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
