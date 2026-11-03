/**
 * Plate layouts and slicer uploads for a build (Milestone 5).
 *
 * - `setPlateLayout`: replace the build's plates with a built-in layout.
 * - `createUpload` / `applyUpload` / `discardUpload`: parse a sliced or unsliced
 *   3MF, let the user map its objects to parts, and replace the plates.
 *
 * Replacing plates detaches print logs from the old plates. Logs attached to a
 * plate (`plateNumber`) would point at plates that no longer exist, so the caller
 * must pass `convertRuns: true` (else 409): each such log becomes part logs, one
 * per part the old plate covered, with grams and hours split between them, and
 * part statuses are left exactly as they are.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { runTargets } from '#lib/domain/actions.ts';
import {
	matchPlates,
	objectKey,
	slugsFor,
	suggestVariants,
	MATCH_THRESHOLD,
	type MatchPart,
	type ObjectMatch
} from '#lib/domain/plates-match.ts';
import { toStoredSummary, type StoredSummary, type ThreeMfSummary } from '#lib/domain/threemf.ts';
import type { BuildView } from '#lib/domain/types.ts';
import { resolveChoices, validateChoices } from '#lib/domain/variants.ts';
import type { ArrangementInfo, ArrangeWarning } from '#lib/domain/arrange.ts';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import type { Silhouette } from '#lib/domain/silhouette.ts';
import { ApiError, buildAccess } from '../access';
import { uploadsDir } from '../config';
import type { Db } from '../db';
import { buildPlates, builds, buildUploads, printRuns, templatePlateLayouts } from '../db/schema';
import { mutateBuild } from './actions';
import {
	ARRANGED_LAYOUT,
	ARRANGED_SOURCE,
	hasPlateRuns,
	layoutHintFor,
	loadFootprints,
	planArrangement,
	signature,
	writePlan
} from './arrange-plan';
import { loadBuildView } from './view';
import { ensureOrientations, ensureSilhouettes } from '../print-geometry/store';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (m: string): never => {
	throw new ApiError(400, m);
};

export const UPLOAD_KIND = '3mf';

// ---- paths

export const uploadDir = (uploadId: string) => join(uploadsDir(), '3mf', uploadId);
export const uploadThumbPath = (uploadId: string, n: number) =>
	join(uploadDir(uploadId), `plate_${n}.png`);
export const buildThumbRel = (buildId: string, n: number) => `plates/${buildId}/${n}.png`;
export const buildThumbAbs = (buildId: string, n: number) =>
	join(uploadsDir(), buildThumbRel(buildId, n));

function clearBuildThumbs(buildId: string) {
	rmSync(join(uploadsDir(), 'plates', buildId), { recursive: true, force: true });
}

// ---- layouts

export interface LayoutInfo {
	key: string;
	name: string;
	printerNote: string;
	isDefault: boolean;
	plateCount: number;
}

export function listLayouts(db: Db, templateId: string): LayoutInfo[] {
	return db
		.select()
		.from(templatePlateLayouts)
		.where(eq(templatePlateLayouts.templateId, templateId))
		.orderBy(asc(templatePlateLayouts.sort))
		.all()
		.map((l) => ({
			key: l.key,
			name: l.name,
			printerNote: l.printerNote,
			isDefault: l.isDefault,
			plateCount: l.plates.length
		}));
}

/** Layouts of the build's template plus the build's current choice (null = template default). */
export function buildLayouts(db: Db, buildId: string, userId: string) {
	if (!buildAccess(db, buildId, userId)) throw new ApiError(404, 'Not found');
	const b = db.select().from(builds).where(eq(builds.id, buildId)).get();
	if (!b) throw new ApiError(404, 'Not found');
	const layouts = listLayouts(db, b.templateId);
	return {
		layouts,
		current: b.plateLayout ?? layouts.find((l) => l.isDefault)?.key ?? null
	};
}

/**
 * Turn print logs attached to plates into part logs. Returns how many logs were
 * converted. Statuses are not touched: part state stays as it is.
 */
function convertPlateRuns(tx: Db, buildId: string, view: BuildView): number {
	const attached = view.runs.filter((r) => r.plateNumber != null);
	for (const r of attached) {
		const targets = runTargets(view, r);
		tx.delete(printRuns).where(eq(printRuns.id, r.id)).run();
		if (!targets.length) continue; // log of a plate whose parts are all inactive: nothing to keep it on
		const share = (v: number | null) =>
			v == null ? null : Math.round((v / targets.length) * 100) / 100;
		for (const slug of targets)
			tx.insert(printRuns)
				.values({
					buildId,
					plateNumber: null,
					partSlug: slug,
					partSlugs: null,
					date: r.date,
					result: r.result,
					grams: share(r.grams),
					hours: share(r.hours),
					printer: r.printer,
					userId: r.userId,
					note: r.note
				})
				.run();
	}
	return attached.length;
}

function requireConversion(view: BuildView, convertRuns: boolean) {
	const n = view.runs.filter((r) => r.plateNumber != null).length;
	if (n > 0 && !convertRuns)
		throw new ApiError(
			409,
			`${n} print log${n === 1 ? ' is' : 's are'} attached to the current plates. Changing the plates converts them to part logs; confirm to continue.`
		);
}

export function setPlateLayout(
	db: Db,
	buildId: string,
	userId: string,
	body: unknown
): { plates: number; convertedRuns: number } {
	if (!isObj(body) || typeof body.key !== 'string') bad('key is required');
	const key = (body as Obj).key as string;
	const convertRuns = (body as Obj).convertRuns === true;
	let result = { plates: 0, convertedRuns: 0 };
	mutateBuild(db, buildId, userId, (tx, view) => {
		const b = tx.select().from(builds).where(eq(builds.id, buildId)).get()!;
		const layout = tx
			.select()
			.from(templatePlateLayouts)
			.where(
				and(eq(templatePlateLayouts.templateId, b.templateId), eq(templatePlateLayouts.key, key))
			)
			.get();
		if (!layout) bad('Unknown plate layout');
		requireConversion(view, convertRuns);
		const convertedRuns = convertPlateRuns(tx, buildId, view);
		tx.delete(buildPlates).where(eq(buildPlates.buildId, buildId)).run();
		for (const p of layout!.plates)
			tx.insert(buildPlates)
				.values({
					buildId,
					number: p.number,
					name: p.name,
					estSeconds: p.estSeconds,
					runs: p.runs,
					perPartRuns: p.perPartRuns ?? false,
					parts: p.parts,
					source: `layout:${key}`
				})
				.run();
		tx.update(builds).set({ plateLayout: key }).where(eq(builds.id, buildId)).run();
		clearBuildThumbs(buildId);
		result = { plates: layout!.plates.length, convertedRuns };
		return {
			kind: 'plates.layout',
			payload: { key, name: layout!.name, plates: layout!.plates.length, convertedRuns }
		};
	});
	return result;
}

// ---- uploads

/** Matching input for the build's template: every part, inactive variants included. */
function matchParts(view: BuildView): MatchPart[] {
	return view.allParts.map((p) => ({
		slug: p.slug,
		name: p.name,
		sourceFile: p.sourceFile,
		notes: p.notes,
		allowedMaterials: p.allowedMaterials,
		components: p.components,
		variantGroup: p.variantGroup,
		variantOption: p.variantOption
	}));
}

const family = (m: string) => (/^[A-Za-z]+/.exec(m.trim())?.[0] ?? '').toUpperCase();

export interface UploadSuggestions {
	/** Per object key (`plate:objectId`): the matcher's verdict. */
	matches: Record<string, ObjectMatch>;
	/** Per object key: suggested part slug, or null when nothing matched well enough. */
	mapping: Record<string, string | null>;
	/** 3MF filament index (as a string) → build filament role key. */
	filamentMap: Record<string, string | null>;
	/** group key → option key, only for groups the file speaks about. */
	variantChoices: Record<string, string>;
}

export function suggestUpload(view: BuildView, summary: StoredSummary): UploadSuggestions {
	const parts = matchParts(view);
	const matches = matchPlates(summary.plates, parts, summary.filaments);
	const mapping: Record<string, string | null> = {};
	for (const [k, m] of Object.entries(matches))
		mapping[k] = m.slug && m.confidence >= MATCH_THRESHOLD ? m.slug : null;
	const roleOf = new Map(view.allParts.map((p) => [p.slug, p.role]));
	const filamentMap: Record<string, string | null> = {};
	for (const f of summary.filaments) {
		const tally = new Map<string, number>();
		for (const pl of summary.plates)
			for (const o of pl.objects) {
				const slug = mapping[objectKey(pl.index, o.id)];
				if (slug && o.filamentIndex === f.index) {
					const role = roleOf.get(slug);
					if (role) tally.set(role, (tally.get(role) ?? 0) + o.count);
				}
			}
		const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
		const byMaterial = view.filaments.find((r) => family(r.material) === family(f.type))?.key;
		filamentMap[String(f.index)] = best ?? byMaterial ?? null;
	}
	const matched = Object.values(mapping).filter((s): s is string => !!s);
	return {
		matches,
		mapping,
		filamentMap,
		variantChoices: suggestVariants(view.variantGroups, matched)
	};
}

/**
 * Store a freshly parsed 3MF for review. Thumbnails go to disk next to the upload so the
 * review screen can show them; the original file is not kept. Older unapplied uploads of
 * the build are discarded.
 */
export function createUpload(
	db: Db,
	buildId: string,
	userId: string,
	file: { name: string; size: number },
	parsed: ThreeMfSummary,
	view: BuildView
): { uploadId: string; summary: StoredSummary; suggestions: UploadSuggestions } {
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	const summary = toStoredSummary(parsed);
	const stale = db
		.select({ id: buildUploads.id })
		.from(buildUploads)
		.where(and(eq(buildUploads.buildId, buildId), eq(buildUploads.status, 'parsed')))
		.all();
	for (const s of stale) rmSync(uploadDir(s.id), { recursive: true, force: true });
	if (stale.length)
		db.update(buildUploads)
			.set({ status: 'discarded' })
			.where(
				inArray(
					buildUploads.id,
					stale.map((s) => s.id)
				)
			)
			.run();
	const row = db
		.insert(buildUploads)
		.values({
			buildId,
			kind: UPLOAD_KIND,
			fileName: file.name.slice(0, 255),
			size: file.size,
			summary: summary as unknown as Obj,
			status: 'parsed',
			createdBy: userId
		})
		.returning({ id: buildUploads.id })
		.get();
	mkdirSync(uploadDir(row.id), { recursive: true });
	for (const p of parsed.plates)
		if (p.thumbnail) writeFileSync(uploadThumbPath(row.id, p.index), p.thumbnail);
	return { uploadId: row.id, summary, suggestions: suggestUpload(view, summary) };
}

function getUpload(db: Db, buildId: string, uploadId: string) {
	const u = db
		.select()
		.from(buildUploads)
		.where(and(eq(buildUploads.id, uploadId), eq(buildUploads.buildId, buildId)))
		.get();
	if (!u) throw new ApiError(404, 'Upload not found');
	return u;
}

/** For the review screen's thumbnails. */
export function uploadThumbnailFile(
	db: Db,
	buildId: string,
	userId: string,
	uploadId: string,
	n: number
) {
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	const u = getUpload(db, buildId, uploadId);
	if (u.status !== 'parsed') throw new ApiError(404, 'Not found');
	const path = uploadThumbPath(uploadId, n);
	if (!existsSync(path)) throw new ApiError(404, 'No thumbnail');
	return path;
}

export function discardUpload(db: Db, buildId: string, userId: string, uploadId: string): void {
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	const u = getUpload(db, buildId, uploadId);
	if (u.status === 'parsed') {
		db.update(buildUploads).set({ status: 'discarded' }).where(eq(buildUploads.id, uploadId)).run();
		rmSync(uploadDir(uploadId), { recursive: true, force: true });
	}
}

function parseMapping(v: unknown, view: BuildView): Record<string, string | null> {
	if (!isObj(v)) return bad('mapping must be an object');
	const out: Record<string, string | null> = {};
	for (const [k, s] of Object.entries(v)) {
		if (s === null || s === '') {
			out[k] = null;
			continue;
		}
		if (typeof s !== 'string' || !view.allParts.some((p) => p.slug === s))
			bad('Unknown part in mapping');
		out[k] = s as string;
	}
	return out;
}

export interface ApplyResult {
	plates: number;
	skipped: number;
	convertedRuns: number;
}

export function applyUpload(
	db: Db,
	buildId: string,
	userId: string,
	uploadId: string,
	body: unknown
): ApplyResult {
	if (!isObj(body)) bad('Invalid body');
	const b = body as Obj;
	const convertRuns = b.convertRuns === true;
	let result: ApplyResult = { plates: 0, skipped: 0, convertedRuns: 0 };
	mutateBuild(db, buildId, userId, (tx, view) => {
		const up = getUpload(tx, buildId, uploadId);
		if (up.status !== 'parsed')
			throw new ApiError(409, 'This upload was already applied or discarded');
		const summary = up.summary as unknown as StoredSummary;
		const mapping = parseMapping(b.mapping, view);

		const filamentMap: Record<string, string> = {};
		if (b.filamentMap !== undefined) {
			if (!isObj(b.filamentMap)) bad('filamentMap must be an object');
			for (const [idx, role] of Object.entries(b.filamentMap as Obj)) {
				if (role === null || role === '') continue;
				if (typeof role !== 'string' || !view.filaments.some((f) => f.key === role))
					bad('Unknown filament in filamentMap');
				filamentMap[idx] = role as string;
			}
		}
		let choices = view.variantChoices;
		if (b.variantChoices !== undefined) {
			if (!isObj(b.variantChoices)) bad('variantChoices must be an object');
			const err = validateChoices(view.variantGroups, b.variantChoices as Obj);
			if (err) bad(err);
			choices = resolveChoices(view.variantGroups, {
				...view.variantChoices,
				...(b.variantChoices as Record<string, string>)
			});
		}

		const rows = summary.plates
			.map((pl) => {
				const slugs = slugsFor(pl.index, pl.objects, mapping);
				const fg: Record<string, number> = {};
				for (const [idx, g] of Object.entries(pl.filamentGrams)) {
					const role = filamentMap[idx];
					if (role && g > 0) fg[role] = Math.round(((fg[role] ?? 0) + g) * 100) / 100;
				}
				return { pl, slugs, fg };
			})
			.filter((r) => r.slugs.length > 0);
		if (!rows.length) bad('Map at least one object to a part first');
		requireConversion(view, convertRuns);

		const convertedRuns = convertPlateRuns(tx, buildId, view);
		tx.delete(buildPlates).where(eq(buildPlates.buildId, buildId)).run();
		clearBuildThumbs(buildId);
		for (const { pl, slugs, fg } of rows) {
			let thumb: string | null = null;
			const src = uploadThumbPath(uploadId, pl.index);
			if (pl.hasThumbnail && existsSync(src)) {
				const dest = buildThumbAbs(buildId, pl.index);
				mkdirSync(dirname(dest), { recursive: true });
				cpSync(src, dest);
				thumb = buildThumbRel(buildId, pl.index);
			}
			tx.insert(buildPlates)
				.values({
					buildId,
					number: pl.index,
					name: pl.name,
					estSeconds: pl.estSeconds,
					runs: Math.max(1, pl.runsHint || 1),
					perPartRuns: false,
					parts: slugs,
					slicerGrams: pl.grams,
					thumbnailPath: thumb,
					filamentGrams: fg,
					source: `upload:${uploadId}`
				})
				.run();
		}
		tx.update(builds)
			.set({ plateLayout: 'upload', variantChoices: choices })
			.where(eq(builds.id, buildId))
			.run();
		tx.update(buildUploads)
			.set({
				status: 'applied',
				summary: { ...(up.summary as Obj), mapping, filamentMap, variantChoices: choices }
			})
			.where(eq(buildUploads.id, uploadId))
			.run();
		rmSync(uploadDir(uploadId), { recursive: true, force: true });
		result = { plates: rows.length, skipped: summary.plates.length - rows.length, convertedRuns };
		return {
			kind: 'plates.upload',
			payload: { uploadId, fileName: up.fileName, ...result, sliced: summary.sliced }
		};
	});
	return result;
}

/** Absolute path of a build plate's thumbnail, or null. */
export function plateThumbnailFile(
	db: Db,
	buildId: string,
	userId: string,
	number: number
): string | null {
	if (!buildAccess(db, buildId, userId)) throw new ApiError(404, 'Not found');
	const row = db
		.select({ p: buildPlates.thumbnailPath })
		.from(buildPlates)
		.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.number, number)))
		.get();
	if (!row?.p || row.p !== buildThumbRel(buildId, number)) return null;
	const abs = join(uploadsDir(), row.p);
	return existsSync(abs) ? abs : null;
}

// ---- arranged plates (printer-aware planner)

/**
 * Replace the build's plates with the arranger's plan for the build's printer. Parts are
 * grouped by filament and packed onto the bed (see `domain/arrange.ts`); positions are kept
 * in `build_plates.arrangement`. Print logs attached to the old plates need `convertRuns`
 * (409 otherwise), exactly like `setPlateLayout`.
 */
export function arrangeForPrinter(
	db: Db,
	buildId: string,
	userId: string,
	body: unknown = {}
): { plates: number; convertedRuns: number; warnings: ArrangeWarning[] } {
	const convertRuns = isObj(body) && body.convertRuns === true;
	let result = { plates: 0, convertedRuns: 0, warnings: [] as ArrangeWarning[] };
	mutateBuild(db, buildId, userId, (tx, view) => {
		if (!view.printer) bad('Choose a printer first');
		const plan = planArrangement(
			view,
			loadFootprints(tx, view.build.templateId),
			layoutHintFor(tx, view.build.templateId)
		)!;
		requireConversion(view, convertRuns);
		const convertedRuns = convertPlateRuns(tx, buildId, view);
		clearBuildThumbs(buildId);
		const plates = writePlan(tx, buildId, plan);
		result = { plates, convertedRuns, warnings: plan.result.warnings };
		return {
			kind: 'plates.arrange',
			payload: {
				printer: view.printer!.name,
				plates,
				convertedRuns,
				warnings: plan.result.warnings.length
			}
		};
	});
	return result;
}

export function buildArrangement(db: Db, buildId: string, userId: string): ArrangementInfo {
	const view = loadBuildView(db, buildId, userId);
	if (!view) throw new ApiError(404, 'Not found');
	const row = db.select().from(builds).where(eq(builds.id, buildId)).get();
	const stored = db
		.select()
		.from(buildPlates)
		.where(eq(buildPlates.buildId, buildId))
		.orderBy(asc(buildPlates.number))
		.all()
		.filter((p) => p.source === ARRANGED_SOURCE && p.arrangement)
		.map((p) => p.arrangement!);
	// Outlines for the diagram: only what is on the plates; computed once, then cached in the row.
	const onPlates = new Set(stored.flatMap((pl) => pl.parts));
	ensureOrientations(db, view.build.templateId);
	ensureSilhouettes(db, view.build.templateId, onPlates);
	const footprints = loadFootprints(db, view.build.templateId);
	const plan = planArrangement(view, footprints, layoutHintFor(db, view.build.templateId));
	const used: Record<string, PrintFootprint> = {};
	for (const pl of stored)
		for (const s of pl.parts) {
			const fp = footprints.get(s);
			if (fp)
				used[s] = {
					...fp,
					pieces: fp.pieces.map((pc) => ({ ...pc, orient: undefined, sil: undefined }))
				};
		}
	const silhouettes: Record<string, Silhouette> = {};
	const plates = stored.map((pl) => ({
		...pl,
		items: pl.items.map((it) => {
			const pc = footprints.get(it.slug)?.pieces[it.piece];
			if (!pc?.sil) return it;
			let key = `${it.slug}:${it.piece}`;
			let sil = pc.sil.profile;
			if (it.pose) {
				const idx =
					pc.orient?.poses.findIndex((p) => p.m.every((v, i) => v === it.pose!.m[i])) ?? -1;
				if (idx < 0 || !pc.sil.poses[idx]) return it; // pose not found: draw the box instead
				key += `:${idx}`;
				sil = pc.sil.poses[idx];
			}
			silhouettes[key] = sil;
			return { ...it, sil: key };
		})
	}));
	return {
		printer: view.printer,
		layout: row?.plateLayout ?? null,
		plates,
		silhouettes,
		fresh: plan
			? {
					plates: plan.result.plates.length,
					warnings: plan.result.warnings,
					unsized: plan.unsized
				}
			: null,
		stale:
			row?.plateLayout === ARRANGED_LAYOUT &&
			!!plan &&
			signature(plan.result.plates) !== signature(stored),
		hasPlateRuns: hasPlateRuns(view),
		footprints: used
	};
}
