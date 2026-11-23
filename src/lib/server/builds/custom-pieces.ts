/**
 * Custom pieces: non-standard accessories or beta replacements a maker adds from a 3MF (issue 113).
 *
 * The file goes up through the ordinary plate upload (`createUpload`); this module turns a parsed upload
 * into a piece: one `build_custom_pieces` row, and for each chosen plate of the file one `build_plates` row
 * (`source = 'custom:<pieceId>'`) with its own part (`custom-<hex>`, a `build_parts` row). The plates keep the
 * time and grams the slicer wrote, are numbered after the kit's plates, are never arranged with kit parts
 * and never exported by the app (see `kitOnly` in `domain/custom.ts`). A piece can replace kit parts; those
 * are marked "Not printing" (`skipPartsTx`) and come back when the piece is removed with `restore`.
 */
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, eq, max } from 'drizzle-orm';
import { CUSTOM_NAME_MAX, MAX_CUSTOM_PIECES, MAX_CUSTOM_PLATES } from '#lib/domain/custom.ts';
import { isObj, type Obj } from '#lib/domain/guards.ts';
import type { StoredSummary } from '#lib/domain/threemf.ts';
import type { BuildView } from '#lib/domain/types.ts';
import { ApiError } from '../access';
import { uploadsDir } from '../config';
import type { Db } from '../db';
import { buildCustomPieces, buildParts, buildPlates, buildUploads } from '../db/schema';
import { mutateBuild, skipPartsTx } from './actions';
import { customThumbRel, removeCustomThumb } from './custom-plates';
import { getUpload, uploadDir, uploadThumbPath } from './plates';

const bad = (m: string): never => {
	throw new ApiError(400, m);
};

/** Most kit parts one piece can replace, and most filament slots a file can map. */
const MAX_REPLACES = 60;
const MAX_SLOTS = 32;
const MAX_RUNS = 20;

/** Trimmed, control and bidi characters dropped, at most `CUSTOM_NAME_MAX` characters. */
export function cleanPieceName(v: unknown): string {
	if (typeof v !== 'string') return bad('name is required');
	const name = v
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, CUSTOM_NAME_MAX)
		.trim();
	if (!name) bad('name is required');
	return name;
}

export interface AddCustomResult {
	pieceId: string;
	/** Numbers of the piece's plates as they are on the Print tab afterwards. */
	plates: number[];
	/** Kit parts that were marked "Not printing". */
	skipped: string[];
}

/**
 * Body `{ name, plates?, runs?, filamentMap, role?, replaces? }` on a parsed upload of the build.
 * Editors and owners; drafts refuse it (no build tracking).
 */
export function addCustomPiece(
	db: Db,
	buildId: string,
	userId: string,
	uploadId: string,
	body: unknown
): AddCustomResult {
	if (!isObj(body)) bad('Invalid body');
	const b = body as Obj;
	let result: AddCustomResult = { pieceId: '', plates: [], skipped: [] };
	const written: string[] = []; // thumbnails copied to disk; removed again when the transaction fails
	try {
		mutateBuild(db, buildId, userId, (tx, view) => {
			const name = cleanPieceName(b.name);
			const up = getUpload(tx, buildId, uploadId);
			if (up.status !== 'parsed')
				throw new ApiError(409, 'This upload was already applied or discarded');
			const summary = up.summary as unknown as StoredSummary;

			// which plates of the file
			let wanted: number[];
			if (b.plates === undefined) wanted = summary.plates.map((p) => p.index);
			else {
				if (
					!Array.isArray(b.plates) ||
					b.plates.length > MAX_CUSTOM_PLATES ||
					b.plates.some((n) => !Number.isInteger(n))
				)
					return bad('plates must be a list of plate numbers of the file');
				wanted = [...new Set(b.plates as number[])];
			}
			const chosen = wanted.map((n) => {
				const pl = summary.plates.find((p) => p.index === n);
				if (!pl) bad(`The file has no plate ${n}`);
				return pl!;
			});
			if (!chosen.length) bad('Choose at least one plate');

			// caps
			if (view.customPieces.length >= MAX_CUSTOM_PIECES)
				bad(`A build can have at most ${MAX_CUSTOM_PIECES} custom pieces`);
			const have = view.customPieces.reduce((n, c) => n + c.plates.length, 0);
			if (have + chosen.length > MAX_CUSTOM_PLATES)
				bad(
					`A build can have at most ${MAX_CUSTOM_PLATES} custom plates (${have} now, ${chosen.length} more asked for)`
				);

			// prints per plate
			const runsOf = new Map<number, number>();
			if (b.runs !== undefined) {
				if (!isObj(b.runs)) bad('runs must be an object');
				for (const [k, v] of Object.entries(b.runs as Obj)) {
					if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_RUNS)
						bad(`runs must be whole numbers from 1 to ${MAX_RUNS}`);
					runsOf.set(Number(k), v as number);
				}
			}

			// the file's filament slots → the build's colours
			const roleKeys = new Set(view.filaments.map((f) => f.key));
			const filamentMap: Record<string, string> = {};
			if (b.filamentMap !== undefined) {
				if (!isObj(b.filamentMap)) bad('filamentMap must be an object');
				const entries = Object.entries(b.filamentMap as Obj);
				if (entries.length > MAX_SLOTS) bad('filamentMap lists too many filaments');
				for (const [idx, role] of entries) {
					if (role === null || role === '') continue;
					if (typeof role !== 'string' || !roleKeys.has(role))
						bad('Unknown filament in filamentMap');
					filamentMap[idx] = role as string;
				}
			}
			let fallback: string | undefined;
			if (b.role !== undefined && b.role !== null && b.role !== '') {
				if (typeof b.role !== 'string' || !roleKeys.has(b.role)) bad('Unknown filament in role');
				fallback = b.role as string;
			}
			fallback ??= Object.values(filamentMap)[0] ?? view.filaments[0]?.key;
			if (!fallback) bad('This build has no filament colours yet');

			// kit parts the piece replaces
			let replaces: string[] = [];
			if (b.replaces !== undefined) {
				if (!Array.isArray(b.replaces) || b.replaces.length > MAX_REPLACES)
					return bad(`replaces must be a list of at most ${MAX_REPLACES} parts`);
				replaces = [...new Set(b.replaces as unknown[])] as string[];
				for (const s of replaces)
					if (typeof s !== 'string' || !view.allParts.some((p) => p.slug === s))
						bad('Unknown part in replaces');
			}

			// plates of the piece: one custom part each
			const pieceId = randomBytes(8).toString('hex');
			const top =
				tx
					.select({ n: max(buildPlates.number) })
					.from(buildPlates)
					.where(eq(buildPlates.buildId, buildId))
					.get()?.n ?? 0;
			const multi = chosen.length > 1;
			const slugs = new Set<string>();
			const items = chosen.map((pl, i) => {
				let slug: string;
				do slug = `custom-${randomBytes(4).toString('hex')}`;
				while (slugs.has(slug));
				slugs.add(slug);
				const label = multi ? `${name} - ${pl.name.trim() || `Plate ${pl.index}`}` : name;
				const fg: Record<string, number> = {};
				for (const [idx, g] of Object.entries(pl.filamentGrams ?? {})) {
					if (!(g > 0)) continue;
					const role = filamentMap[idx];
					if (!role) bad(`Choose a colour for filament ${idx}`);
					fg[role] = Math.round(((fg[role] ?? 0) + g) * 100) / 100;
				}
				// the colour carrying most of the plate's grams; the chosen fallback when nothing is known
				const role = Object.entries(fg).sort((a, c) => c[1] - a[1])[0]?.[0] ?? fallback!;
				const total = Object.values(fg).reduce((a, c) => a + c, 0);
				const grams =
					pl.grams && pl.grams > 0 ? pl.grams : total > 0 ? Math.round(total * 100) / 100 : null;
				return { pl, slug, label, fg, role, grams, number: top + 1 + i };
			});

			// kit parts that go: validated and written first, so a "printing right now" refusal leaves nothing behind
			let skipped: string[] = [];
			let skippedNames: string[] = [];
			if (replaces.length) {
				const r = skipPartsTx(tx, view, replaces, true);
				skipped = r.changed;
				skippedNames = r.names;
			}

			tx.insert(buildCustomPieces)
				.values({
					id: pieceId,
					buildId,
					name,
					fileName: up.fileName,
					sliced: summary.sliced,
					replaces: skipped,
					parts: items.map((x) => ({ slug: x.slug, name: x.label, role: x.role })),
					createdBy: userId
				})
				.run();
			for (const x of items) {
				tx.insert(buildParts).values({ buildId, partSlug: x.slug }).run();
				let thumb: string | null = null;
				const src = uploadThumbPath(uploadId, x.pl.index);
				if (x.pl.hasThumbnail && existsSync(src)) {
					const rel = customThumbRel(buildId, x.slug);
					const dest = join(uploadsDir(), rel);
					mkdirSync(dirname(dest), { recursive: true });
					cpSync(src, dest);
					written.push(dest);
					thumb = rel;
				}
				tx.insert(buildPlates)
					.values({
						buildId,
						number: x.number,
						name: x.label,
						estSeconds: summary.sliced ? x.pl.estSeconds : null,
						runs: runsOf.get(x.pl.index) ?? 1,
						perPartRuns: false,
						parts: [x.slug],
						slicerGrams: summary.sliced ? x.grams : null,
						slicerGramsSource: summary.sliced && x.grams ? 'file' : null,
						slicerByPart: {},
						thumbnailPath: thumb,
						filamentGrams: summary.sliced ? x.fg : {},
						source: `custom:${pieceId}`
					})
					.run();
			}
			tx.update(buildUploads)
				.set({
					status: 'applied',
					summary: { ...(up.summary as Obj), filamentMap, customPieceId: pieceId }
				})
				.where(eq(buildUploads.id, uploadId))
				.run();
			rmSync(uploadDir(uploadId), { recursive: true, force: true });
			result = { pieceId, plates: items.map((x) => x.number), skipped };
			return {
				kind: 'custom.add',
				payload: {
					pieceId,
					name,
					fileName: up.fileName,
					plates: result.plates,
					sliced: summary.sliced,
					replaced: skippedNames
				}
			};
		});
	} catch (e) {
		for (const f of written) rmSync(f, { force: true });
		throw e;
	}
	// A re-arrange right after the add renumbers custom plates (they follow the new kit plates): read the final numbers.
	const final = db
		.select({ n: buildPlates.number })
		.from(buildPlates)
		.where(
			and(eq(buildPlates.buildId, buildId), eq(buildPlates.source, `custom:${result.pieceId}`))
		)
		.all()
		.map((r) => r.n)
		.sort((a, c) => a - c);
	return { ...result, plates: final.length ? final : result.plates };
}

/**
 * Remove a custom piece: its plates, parts and thumbnails go for good, only while nothing was printed
 * (no print log on it, nothing Printing or on a live printer job); otherwise 409 and the maker marks it
 * "Not printing" instead. With `restore` the kit parts it replaced that are still "Not printing" come back.
 */
export function removeCustomPiece(
	db: Db,
	buildId: string,
	userId: string,
	pieceId: string,
	opts: { restore?: boolean } = {}
): { restored: string[] } {
	let restored: string[] = [];
	mutateBuild(db, buildId, userId, (tx, view: BuildView, now) => {
		const piece = view.customPieces.find((c) => c.id === pieceId);
		if (!piece) throw new ApiError(404, 'Custom piece not found');
		if (!piece.removable)
			throw new ApiError(
				409,
				`"${piece.name}" has print logs or is printing, so it cannot be removed. Mark it "Not printing" instead.`
			);
		let names: string[] = [];
		if (opts.restore) {
			const still = new Set(view.skipped.map((s) => s.slug));
			const back = piece.replaces.filter((s) => still.has(s));
			if (back.length) {
				const r = skipPartsTx(tx, view, back, false, now);
				names = r.names;
			}
		}
		tx.delete(buildPlates)
			.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.source, `custom:${pieceId}`)))
			.run();
		for (const slug of piece.parts) {
			tx.delete(buildParts)
				.where(and(eq(buildParts.buildId, buildId), eq(buildParts.partSlug, slug)))
				.run();
			removeCustomThumb(buildId, slug);
		}
		tx.delete(buildCustomPieces).where(eq(buildCustomPieces.id, pieceId)).run();
		restored = names;
		return { kind: 'custom.remove', payload: { pieceId, name: piece.name, restored: names } };
	});
	return { restored };
}
