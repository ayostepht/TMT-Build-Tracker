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
import { and, asc, eq, max } from 'drizzle-orm';
import { CUSTOM_NAME_MAX, MAX_CUSTOM_PIECES, MAX_CUSTOM_PLATES } from '#lib/domain/custom.ts';
import { isObj, type Obj } from '#lib/domain/guards.ts';
import type { StoredSummary } from '#lib/domain/threemf.ts';
import type { BuildView } from '#lib/domain/types.ts';
import { ApiError } from '../access';
import { uploadsDir } from '../config';
import type { Db } from '../db';
import { buildCustomPieces, buildParts, buildPlates, buildUploads } from '../db/schema';
import { MAX_PRINT_SECONDS } from '#lib/domain/format.ts';
import { MAX_PART_GRAMS, mutateBuild, skipPartsTx } from './actions';
import { customThumbRel, removeCustomThumb } from './custom-plates';
import { getUpload, uploadDir, uploadThumbPath } from './plates';

const bad = (m: string): never => {
	throw new ApiError(400, m);
};

/** Most kit parts one piece can replace, and most filament slots a file can map. */
const MAX_REPLACES = 60;
const MAX_SLOTS = 32;
export const MAX_RUNS = 20;
const MAX_TYPED = 1000;

/** Text from a file or a form: control and bidi characters dropped, spaces collapsed, at most `max` characters. */
export function cleanText(v: unknown, max: number): string {
	return typeof v === 'string'
		? v
				// eslint-disable-next-line no-control-regex
				.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
				.slice(0, max)
				.trim()
		: '';
}

/** Trimmed, control and bidi characters dropped, at most `CUSTOM_NAME_MAX` characters. */
export function cleanPieceName(v: unknown): string {
	if (typeof v !== 'string') return bad('name is required');
	const name = cleanText(v, CUSTOM_NAME_MAX);
	if (!name) bad('name is required');
	return name;
}

/** Longest own name of one plate inside a label, and longest file name kept. */
export const PLATE_NAME_MAX = 80;
export const FILE_NAME_MAX = 255;

/**
 * Name of a plate (and its part) of a piece: the piece's name, plus the plate's own name when it has several.
 * The plate's own name comes from a file or a saved part: it is cleaned and capped here (new labels only; a
 * stored longer one still loads, and is shortened when the piece is renamed).
 */
export function customPlateLabel(
	pieceName: string,
	plateName: string,
	multi: boolean,
	fallbackNumber: number
): string {
	return multi
		? `${pieceName} - ${cleanText(plateName, PLATE_NAME_MAX) || `Plate ${fallbackNumber}`}`
		: pieceName;
}

/** The plate's own name inside a label made by `customPlateLabel`; null when it does not follow that form. */
export function ownPlateName(label: string, pieceName: string): string | null {
	const prefix = `${pieceName} - `;
	return label.startsWith(prefix) ? label.slice(prefix.length) : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A typed print time: whole seconds from 1 up to 30 days. */
export function cleanSeconds(v: unknown, field = 'time'): number {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > MAX_PRINT_SECONDS)
		return bad(`${field} must be from 1 second to 30 days`);
	return Math.round(v);
}

/** Typed grams of one print: more than 0, at most the part weight limit, two decimals. */
export function cleanGrams(v: unknown, field = 'grams'): number {
	const msg = `${field} must be more than 0 and at most ${MAX_PART_GRAMS}`;
	if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0) || v > MAX_PART_GRAMS)
		return bad(msg);
	const g = round2(v);
	return g > 0 ? g : bad(msg);
}

/**
 * Add `g` grams to a role of a grams-by-role map. Role keys such as `constructor` or `toString` are valid
 * filament keys, so the current value is read only when it is the map's own (never an inherited function).
 */
export function addGram(fg: Record<string, number>, role: string, g: number): void {
	Object.defineProperty(fg, role, {
		value: round2((Object.hasOwn(fg, role) ? fg[role] : 0) + g),
		enumerable: true,
		writable: true,
		configurable: true
	});
}

/** Scale per-role grams so they add up to `total` (proportionally). */
export function scaleGrams(fg: Record<string, number>, total: number): Record<string, number> {
	const sum = Object.values(fg).reduce((a, c) => a + c, 0);
	if (!(sum > 0)) return { ...fg };
	return Object.fromEntries(Object.entries(fg).map(([k, g]) => [k, round2((g * total) / sum)]));
}

/** `{ "<file plate number>": value }` into a map; keys must be whole numbers (never `__proto__`). */
function typedByPlate(
	v: unknown,
	field: string,
	check: (n: unknown, f: string) => number
): Map<number, number> {
	const out = new Map<number, number>();
	if (v === undefined) return out;
	if (!isObj(v)) return bad(`${field} must be an object`);
	const entries = Object.entries(v as Obj);
	if (entries.length > MAX_TYPED) return bad(`${field} lists too many plates`);
	for (const [k, val] of entries) {
		if (!/^\d{1,6}$/.test(k)) return bad(`${field} must be keyed by plate number`);
		if (val === null) continue;
		out.set(Number(k), check(val, field));
	}
	return out;
}

/**
 * A `replaces` list from a request: at most `MAX_REPLACES` distinct slugs of the build's kit parts (anything else
 * is a 400). Kit parts a color option made inactive and parts already "Not printing" need no skip and are left
 * out, like the saved list's own filter does; Printing parts stay in (the skip refuses them with 409).
 */
export function cleanReplaces(view: BuildView, v: unknown): string[] {
	if (!Array.isArray(v) || v.length > MAX_REPLACES)
		return bad(`replaces must be a list of at most ${MAX_REPLACES} parts`);
	const out = [...new Set(v as unknown[])] as string[];
	const known = new Set(view.allParts.map((p) => p.slug));
	for (const s of out) if (typeof s !== 'string' || !known.has(s)) bad('Unknown part in replaces');
	const active = new Set(view.parts.map((p) => p.slug));
	const skipped = new Set(view.skipped.map((s) => s.slug));
	return out.filter((s) => active.has(s) && !skipped.has(s));
}

/** One plate of a piece about to be inserted (already validated and mapped onto the build's colors). */
export interface NewPiecePlate {
	/** Plate and part name. */
	label: string;
	/** A build filament role key. */
	role: string;
	estSeconds: number | null;
	/** A time the maker typed (stored with source 'user'). */
	manualEstSeconds: number | null;
	slicerGrams: number | null;
	slicerGramsSource: 'user' | 'file' | null;
	filamentGrams: Record<string, number>;
	runs: number;
	/** A thumbnail file to copy into the build's folder; null for none. */
	thumbSource: string | null;
}

export interface NewPiece {
	name: string;
	fileName: string | null;
	sliced: boolean;
	/** Kit part slugs to mark "Not printing"; already validated, all active and not printing. */
	replaces: string[];
	libraryId: string | null;
	plates: NewPiecePlate[];
}

/**
 * The one place a custom piece is written into a build: the piece row, one part and one plate per plate
 * (numbered after the highest plate), and the kit parts it replaces marked "Not printing" (written first, so
 * a "printing right now" refusal leaves nothing behind). Thumbnails copied to disk are pushed on `written` so
 * the caller can remove them when the transaction fails. Used by `addCustomPiece` and the library.
 */
export function insertCustomPieceTx(
	tx: Db,
	view: BuildView,
	piece: NewPiece,
	userId: string,
	written: string[]
): { pieceId: string; plates: number[]; skipped: string[]; skippedNames: string[] } {
	const buildId = view.build.id;
	const pieceId = randomBytes(8).toString('hex');
	const top =
		tx
			.select({ n: max(buildPlates.number) })
			.from(buildPlates)
			.where(eq(buildPlates.buildId, buildId))
			.get()?.n ?? 0;
	const slugs = new Set<string>();
	const items = piece.plates.map((pl, i) => {
		let slug: string;
		do slug = `custom-${randomBytes(4).toString('hex')}`;
		while (slugs.has(slug));
		slugs.add(slug);
		return { pl, slug, number: top + 1 + i };
	});

	let skipped: string[] = [];
	let skippedNames: string[] = [];
	if (piece.replaces.length) {
		const r = skipPartsTx(tx, view, piece.replaces, true);
		skipped = r.changed;
		skippedNames = r.names;
	}

	tx.insert(buildCustomPieces)
		.values({
			id: pieceId,
			buildId,
			name: piece.name,
			fileName: piece.fileName,
			sliced: piece.sliced,
			replaces: skipped,
			parts: items.map((x) => ({ slug: x.slug, name: x.pl.label, role: x.pl.role })),
			libraryId: piece.libraryId,
			createdBy: userId
		})
		.run();
	for (const x of items) {
		tx.insert(buildParts).values({ buildId, partSlug: x.slug }).run();
		let thumb: string | null = null;
		if (x.pl.thumbSource) {
			const rel = customThumbRel(buildId, x.slug);
			const dest = join(uploadsDir(), rel);
			mkdirSync(dirname(dest), { recursive: true });
			cpSync(x.pl.thumbSource, dest);
			written.push(dest);
			thumb = rel;
		}
		tx.insert(buildPlates)
			.values({
				buildId,
				number: x.number,
				name: x.pl.label,
				estSeconds: x.pl.estSeconds,
				manualEstSeconds: x.pl.manualEstSeconds,
				manualEstSource: x.pl.manualEstSeconds ? 'user' : null,
				runs: x.pl.runs,
				perPartRuns: false,
				parts: [x.slug],
				slicerGrams: x.pl.slicerGrams,
				slicerGramsSource: x.pl.slicerGramsSource,
				slicerByPart: {},
				thumbnailPath: thumb,
				filamentGrams: x.pl.filamentGrams,
				source: `custom:${pieceId}`
			})
			.run();
	}
	return { pieceId, plates: items.map((x) => x.number), skipped, skippedNames };
}

export interface AddCustomResult {
	pieceId: string;
	/** Numbers of the piece's plates as they are on the Print tab afterwards. */
	plates: number[];
	/** Kit parts that were marked "Not printing". */
	skipped: string[];
}

/**
 * Body `{ name, plates?, runs?, times?, grams?, filamentMap, role?, replaces? }` on a parsed upload of the build.
 * Editors and owners; a Studio draft takes custom pieces too.
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

			// times and grams the maker typed per file plate (own numeric keys only)
			const timesOf = typedByPlate(b.times, 'times', cleanSeconds);
			const gramsOf = typedByPlate(b.grams, 'grams', cleanGrams);

			// the file's filament slots → the build's colours
			const roleKeys = new Set(view.filaments.map((f) => f.key));
			// own keys only: slot ids come from the file and may be `constructor` or `__proto__`
			const filamentMap: Record<string, string> = Object.create(null);
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
			// slots the maker set to "Not used in this build" (a support filament, say): their grams are dropped
			const ignore = new Set<string>();
			if (b.ignore !== undefined) {
				if (!Array.isArray(b.ignore) || b.ignore.length > MAX_SLOTS)
					return bad('ignore must be a list of filament slots');
				for (const i of b.ignore as unknown[]) {
					if (typeof i !== 'string' || !i || i.length > 16) return bad('ignore must list slot ids');
					ignore.add(i);
				}
			}
			fallback ??= Object.values(filamentMap)[0] ?? view.filaments[0]?.key;
			if (!fallback || !roleKeys.has(fallback)) bad('This build has no filament colours yet');

			// kit parts the piece replaces
			const replaces = b.replaces === undefined ? [] : cleanReplaces(view, b.replaces);

			// plates of the piece: one custom part each
			const multi = chosen.length > 1;
			const plateSpecs: NewPiecePlate[] = chosen.map((pl) => {
				const label = customPlateLabel(name, pl.name, multi, pl.index);
				const fg: Record<string, number> = {};
				let dropped = 0;
				let slotsWithGrams = 0;
				for (const [idx, g] of Object.entries(pl.filamentGrams ?? {})) {
					if (!(g > 0)) continue;
					slotsWithGrams++;
					if (ignore.has(idx)) {
						dropped += g;
						continue;
					}
					const role = Object.hasOwn(filamentMap, idx) ? filamentMap[idx] : undefined;
					if (!role || !roleKeys.has(role)) return bad(`Choose a colour for filament ${idx}`);
					addGram(fg, role, g);
				}
				if (summary.sliced && slotsWithGrams > 0 && !Object.keys(fg).length)
					return bad(
						`Keep at least one filament on plate ${pl.index}: all of its filaments are set to "Not used in this build"`
					);
				// the colour carrying most of the plate's grams; the chosen fallback when nothing is known
				let role = Object.entries(fg).sort((a, c) => c[1] - a[1])[0]?.[0] ?? fallback!;
				if (!roleKeys.has(role)) role = fallback!;
				const total = Object.values(fg).reduce((a, c) => a + c, 0);
				// the plate's weight without the ignored filaments (the file's total less their grams)
				const keptOfFile =
					pl.grams && pl.grams > 0 ? (dropped > 0 ? round2(pl.grams - dropped) : pl.grams) : 0;
				const fileGrams =
					summary.sliced && pl.grams && pl.grams > 0
						? keptOfFile > 0
							? keptOfFile
							: total > 0
								? round2(total)
								: pl.grams
						: summary.sliced && total > 0
							? round2(total)
							: null;
				const fileSeconds = summary.sliced ? pl.estSeconds : null;
				// a typed value equal to the file's is the file's; a different one is the maker's own
				const typedSeconds = timesOf.get(pl.index);
				const typedGrams = gramsOf.get(pl.index);
				const gramsTyped = typedGrams !== undefined && typedGrams !== fileGrams;
				const src = uploadThumbPath(uploadId, pl.index);
				return {
					label,
					role,
					estSeconds: fileSeconds,
					manualEstSeconds:
						typedSeconds !== undefined && typedSeconds !== fileSeconds ? typedSeconds : null,
					slicerGrams: gramsTyped ? typedGrams! : fileGrams,
					slicerGramsSource: gramsTyped ? ('user' as const) : fileGrams ? ('file' as const) : null,
					// per-colour grams follow a typed total; with none in the file, the part's colour carries it
					filamentGrams: !summary.sliced ? {} : gramsTyped ? scaleGrams(fg, typedGrams!) : fg,
					runs: runsOf.get(pl.index) ?? 1,
					thumbSource: pl.hasThumbnail && existsSync(src) ? src : null
				};
			});

			const made = insertCustomPieceTx(
				tx,
				view,
				{
					name,
					fileName: cleanText(up.fileName, FILE_NAME_MAX) || null,
					sliced: summary.sliced,
					replaces,
					libraryId: null,
					plates: plateSpecs
				},
				userId,
				written
			);
			const { pieceId, skipped, skippedNames } = made;
			tx.update(buildUploads)
				.set({
					status: 'applied',
					summary: { ...(up.summary as Obj), filamentMap, customPieceId: pieceId }
				})
				.where(eq(buildUploads.id, uploadId))
				.run();
			result = { pieceId, plates: made.plates, skipped };
			return {
				kind: 'custom.add',
				payload: {
					pieceId,
					name,
					fileName: cleanText(up.fileName, FILE_NAME_MAX) || null,
					// numbers can still change in the automatic re-arrange that follows: not recorded
					plates: [],
					sliced: summary.sliced,
					replaced: skippedNames
				}
			};
		});
	} catch (e) {
		// `mutateBuild` also publishes after the commit, and that can throw: when the piece row exists the
		// commit happened, its thumbnails are the plates' own pictures and stay, and the upload is used up.
		// Only a failed transaction removes what it copied to disk.
		const saved =
			!!result.pieceId &&
			!!db
				.select({ id: buildCustomPieces.id })
				.from(buildCustomPieces)
				.where(eq(buildCustomPieces.id, result.pieceId))
				.get();
		if (saved) rmSync(uploadDir(uploadId), { recursive: true, force: true });
		else for (const f of written) rmSync(f, { force: true });
		throw e;
	}
	// the stored 3MF's folder goes only once the add has been saved
	rmSync(uploadDir(uploadId), { recursive: true, force: true });
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
 * Rename a custom piece: its row, its parts and its plates (named as `customPlateLabel` names them at
 * insert). Editors and owners. A saved part the piece is linked to is not changed.
 */
export function renameCustomPiece(
	db: Db,
	buildId: string,
	userId: string,
	pieceId: string,
	body: unknown
): { name: string } {
	if (!isObj(body)) bad('Invalid body');
	let name = '';
	mutateBuild(db, buildId, userId, (tx) => {
		name = cleanPieceName((body as Obj).name);
		const piece = tx
			.select()
			.from(buildCustomPieces)
			.where(and(eq(buildCustomPieces.id, pieceId), eq(buildCustomPieces.buildId, buildId)))
			.get();
		if (!piece) throw new ApiError(404, 'Custom piece not found');
		if (piece.name === name) return { kind: 'custom.rename', payload: {}, skip: true };
		const rows = tx
			.select()
			.from(buildPlates)
			.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.source, `custom:${pieceId}`)))
			.orderBy(asc(buildPlates.number))
			.all();
		const multi = rows.length > 1;
		const labelOf = new Map<string, string>();
		rows.forEach((r, i) => {
			const label = customPlateLabel(name, ownPlateName(r.name, piece.name) ?? '', multi, i + 1);
			tx.update(buildPlates)
				.set({ name: label })
				.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.number, r.number)))
				.run();
			if (r.parts[0]) labelOf.set(r.parts[0], label);
		});
		tx.update(buildCustomPieces)
			.set({ name, parts: piece.parts.map((p) => ({ ...p, name: labelOf.get(p.slug) ?? p.name })) })
			.where(eq(buildCustomPieces.id, pieceId))
			.run();
		return { kind: 'custom.rename', payload: { pieceId, name, from: piece.name } };
	});
	return { name };
}

/**
 * Re-key a part's colors: `mapped` is { current role: new role } (both already validated). Grams of roles that
 * land on the same new role are added; the part's role becomes the one with most grams (the renamed
 * current role on a tie), or its mapped role when there are no grams.
 */
export function rekeyRoles(
	fg: Record<string, number>,
	role: string,
	mapped: ReadonlyMap<string, string>
): { filamentGrams: Record<string, number>; role: string } {
	const next: Record<string, number> = {};
	for (const [r, g] of Object.entries(fg)) addGram(next, mapped.get(r) ?? r, g);
	// a stored role that is not one of the gram keys is renamed by the map like any other
	const renamed = mapped.get(role) ?? role;
	const entries = Object.entries(next);
	if (!entries.length) return { filamentGrams: next, role: renamed };
	const max = Math.max(...entries.map(([, g]) => g));
	const heaviest = entries.filter(([, g]) => g === max).map(([k]) => k);
	return { filamentGrams: next, role: heaviest.includes(renamed) ? renamed : heaviest[0] };
}

/**
 * `PATCH` of a custom piece: `{ name }` renames it, `{ roles }` recolors its parts; both in one body is a 400
 * (two changes with two activity rows belong in two requests).
 */
export function patchCustomPiece(
	db: Db,
	buildId: string,
	userId: string,
	pieceId: string,
	body: unknown
): { name: string } | { changes: RecolorChange[] } {
	if (isObj(body) && body.roles !== undefined) {
		if (body.name !== undefined) return bad('Send name or roles, not both');
		return recolorCustomPiece(db, buildId, userId, pieceId, body);
	}
	return renameCustomPiece(db, buildId, userId, pieceId, body);
}

/** One color change of a custom part: role keys of the build's filaments. */
export interface RecolorChange {
	/** The part's name (its label on the Print tab). */
	part: string;
	from: string;
	to: string;
}

/**
 * Change the color of a custom piece's parts in this build. Body
 * `{ roles: { "<part slug of this piece>": { "<current role>": "<new role>" } } }`: a single-color part has one
 * entry, a multi-color part one per role its plate uses. The part's `role` and its plate's `filament_grams` are
 * re-keyed (two roles mapping to one merge their grams; the part's role is then the one with most grams).
 * Roles must be filaments of the build and the `from` roles ones the part has now. Unchanged = no-op, no
 * activity row. A saved part the piece is linked to is not changed. Editors and owners; drafts too. Not a
 * re-arrange kind, like `design.recolor`: custom plates are never arranged.
 */
export function recolorCustomPiece(
	db: Db,
	buildId: string,
	userId: string,
	pieceId: string,
	body: unknown
): { changes: RecolorChange[] } {
	if (!isObj(body) || !isObj((body as Obj).roles)) return bad('roles must be an object');
	const roles = (body as Obj).roles as Obj;
	const slugEntries = Object.entries(roles);
	if (!slugEntries.length || slugEntries.length > MAX_CUSTOM_PLATES)
		return bad('roles must name the parts to recolor');
	let changes: RecolorChange[] = [];
	mutateBuild(db, buildId, userId, (tx, view) => {
		const piece = tx
			.select()
			.from(buildCustomPieces)
			.where(and(eq(buildCustomPieces.id, pieceId), eq(buildCustomPieces.buildId, buildId)))
			.get();
		if (!piece) throw new ApiError(404, 'Custom piece not found');
		const roleKeys = new Set(view.filaments.map((f) => f.key));
		const done: RecolorChange[] = [];
		const nextParts = piece.parts.map((p) => ({ ...p }));
		for (const [slug, map] of slugEntries) {
			const part = nextParts.find((p) => p.slug === slug);
			if (!part) return bad('That part is not in this custom piece');
			if (!isObj(map)) return bad('Each part needs a map of current color to new color');
			const pairs = Object.entries(map as Obj);
			if (!pairs.length || pairs.length > MAX_SLOTS) return bad('Name the colors to change');
			const plate = tx
				.select()
				.from(buildPlates)
				.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.source, `custom:${pieceId}`)))
				.all()
				.find((r) => r.parts[0] === slug);
			const fg = { ...(plate?.filamentGrams ?? {}) };
			const have = new Set([part.role, ...Object.keys(fg)]);
			const mapped = new Map<string, string>();
			for (const [from, to] of pairs) {
				if (typeof to !== 'string' || !roleKeys.has(to)) return bad('Unknown color in roles');
				if (!have.has(from)) return bad(`"${part.name}" has no ${from} color to change`);
				if (from !== to) mapped.set(from, to);
			}
			if (!mapped.size) continue;
			const re = rekeyRoles(fg, part.role, mapped);
			part.role = re.role;
			if (plate)
				tx.update(buildPlates)
					.set({ filamentGrams: re.filamentGrams })
					.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.number, plate.number)))
					.run();
			for (const [from, to] of mapped) done.push({ part: part.name, from, to });
		}
		if (!done.length) return { kind: 'custom.recolor', payload: {}, skip: true };
		tx.update(buildCustomPieces)
			.set({ parts: nextParts })
			.where(eq(buildCustomPieces.id, pieceId))
			.run();
		changes = done;
		return { kind: 'custom.recolor', payload: { pieceId, name: piece.name, changes: done } };
	});
	return { changes };
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
