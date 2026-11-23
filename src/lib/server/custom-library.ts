/**
 * The workspace's saved custom parts (issue 113, part 2).
 *
 * A maker can save a custom piece of a build to the workspace ("Save for new builds"). The library keeps
 * per-plate summaries only (name, time, grams per filament role, part role, prints): never the 3MF, and
 * in this prototype no thumbnails. A saved part can then be added to any build of the same workspace in
 * one step (`applyLibraryPiece`) or to every new build by default (`isDefault`, applied by `createBuild`
 * through `applyLibraryPieceTx`), so time and filament are estimated from the start.
 *
 * Access: every row belongs to one organization. Reads are for members, writes for editors and owners;
 * an id from another workspace is a 404, never trusted.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { MAX_CUSTOM_PIECES, MAX_CUSTOM_PLATES } from '#lib/domain/custom.ts';
import { isObj, type Obj } from '#lib/domain/guards.ts';
import type { BuildView } from '#lib/domain/types.ts';
import { ApiError, buildAccess, requireEditor, requireMember } from './access';
import {
	cleanGrams,
	cleanPieceName,
	cleanSeconds,
	customPlateLabel,
	insertCustomPieceTx,
	ownPlateName,
	scaleGrams,
	type NewPiecePlate
} from './builds/custom-pieces';
import { livePrintingSlugs, mutateBuild } from './builds/actions';
import { loadBuildView } from './builds/view';
import type { Db } from './db';
import {
	buildCustomPieces,
	buildPlates,
	user,
	workspaceCustomPieces,
	type LibraryPlate
} from './db/schema';
import { emitBuildEvent } from './events';

/** Most saved custom parts one workspace can hold. */
export const MAX_LIBRARY_PIECES = 50;

export type LibraryRow = typeof workspaceCustomPieces.$inferSelect;

/** What the API and the UI see of a saved part (no creator, no file data). */
export interface LibraryPieceView {
	id: string;
	name: string;
	fileName: string | null;
	sliced: boolean;
	templateId: string | null;
	replaces: string[];
	plates: {
		/** Position in the saved part (0-based): what `updateLibraryPiece` `plates[].index` means. */
		index: number;
		name: string;
		estSeconds: number | null;
		grams: number | null;
		role: string;
		runs: number;
	}[];
	isDefault: boolean;
	/** All prints of all plates, seconds (plates without a time count 0). */
	totalSeconds: number;
	/** All prints of all plates, grams (plates without grams count 0). */
	totalGrams: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const toView = (r: LibraryRow): LibraryPieceView => {
	const plates = r.plates ?? [];
	return {
		id: r.id,
		name: r.name,
		fileName: r.fileName,
		sliced: r.sliced,
		templateId: r.templateId,
		replaces: r.replaces ?? [],
		plates: plates.map((p, i) => ({
			index: i,
			name: p.name,
			estSeconds: p.estSeconds,
			grams: p.grams,
			role: p.role,
			runs: p.runs
		})),
		isDefault: r.isDefault,
		totalSeconds: plates.reduce((n, p) => n + (p.estSeconds ?? 0) * p.runs, 0),
		totalGrams: round2(plates.reduce((n, p) => n + (p.grams ?? 0) * p.runs, 0))
	};
};

/** The workspace's saved parts, newest last (members only; 404 to anyone else). */
export function listLibrary(db: Db, orgId: string, userId: string): LibraryPieceView[] {
	requireMember(db, orgId, userId);
	return listLibraryRows(db, orgId).map(toView);
}

/** The rows of a workspace's library, oldest first. No access check: callers have one. */
export function listLibraryRows(db: Db, orgId: string): LibraryRow[] {
	return db
		.select()
		.from(workspaceCustomPieces)
		.where(eq(workspaceCustomPieces.organizationId, orgId))
		.orderBy(asc(workspaceCustomPieces.createdAt), asc(workspaceCustomPieces.name))
		.all();
}

function rowOf(db: Db, orgId: string, libId: unknown): LibraryRow {
	if (typeof libId !== 'string') throw new ApiError(404, 'Not found');
	const row = db
		.select()
		.from(workspaceCustomPieces)
		.where(eq(workspaceCustomPieces.id, libId))
		.get();
	// a row of another workspace is as good as missing
	if (!row || row.organizationId !== orgId) throw new ApiError(404, 'Not found');
	return row;
}

function announce(db: Db, buildId: string, userId: string, kind: string): void {
	const u = db.select({ name: user.name }).from(user).where(eq(user.id, userId)).get();
	emitBuildEvent(buildId, {
		type: 'changed',
		kind,
		by: u?.name ?? null,
		at: new Date().toISOString()
	});
}

/**
 * The per-plate summaries of a build's custom piece as the library keeps them: the typed time wins over
 * the file's, grams are the plate's (typed or file) with the per-color split, role is the part's color.
 */
function piecePlates(
	tx: Db,
	userId: string,
	buildId: string,
	piece: typeof buildCustomPieces.$inferSelect
): LibraryPlate[] {
	const view = loadBuildView(tx, buildId, userId);
	if (!view) throw new ApiError(404, 'Not found');
	const rows = tx
		.select()
		.from(buildPlates)
		.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.source, `custom:${piece.id}`)))
		.orderBy(asc(buildPlates.number))
		.all();
	return rows.map((r) => {
		const slug = r.parts[0];
		const part = piece.parts.find((p) => p.slug === slug);
		const role = view.parts.find((p) => p.slug === slug)?.role ?? part?.role ?? '';
		return {
			name: ownPlateName(r.name, piece.name) ?? r.name,
			estSeconds: r.manualEstSeconds ?? r.estSeconds ?? null,
			grams: r.slicerGrams ?? null,
			filamentGrams: { ...(r.filamentGrams ?? {}) },
			role,
			runs: r.runs,
			thumb: false
		};
	});
}

/**
 * Save a custom piece of a build to its workspace's library and link the piece to the row. The typed time
 * of a plate wins over the file's. Saving a piece that is already linked to a library row changes nothing
 * and returns that row. Editors and owners; drafts refuse it. At most `MAX_LIBRARY_PIECES` per workspace.
 */
export function saveToLibrary(
	db: Db,
	userId: string,
	buildId: string,
	pieceId: string,
	opts: { isDefault?: boolean } = {}
): LibraryPieceView {
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	if (access.kind === 'draft')
		throw new ApiError(400, 'Drafts have no build tracking. Make it a build first.');
	if (opts.isDefault !== undefined && typeof opts.isDefault !== 'boolean')
		throw new ApiError(400, 'isDefault must be true or false');
	const row = db.transaction((txRaw) => {
		const tx = txRaw as unknown as Db;
		const piece = tx
			.select()
			.from(buildCustomPieces)
			.where(and(eq(buildCustomPieces.id, pieceId), eq(buildCustomPieces.buildId, buildId)))
			.get();
		if (!piece) throw new ApiError(404, 'Custom piece not found');
		if (piece.libraryId) {
			const linked = tx
				.select()
				.from(workspaceCustomPieces)
				.where(
					and(
						eq(workspaceCustomPieces.id, piece.libraryId),
						eq(workspaceCustomPieces.organizationId, access.organizationId)
					)
				)
				.get();
			if (linked) return linked;
		}
		const have = tx
			.select({ id: workspaceCustomPieces.id })
			.from(workspaceCustomPieces)
			.where(eq(workspaceCustomPieces.organizationId, access.organizationId))
			.all().length;
		if (have >= MAX_LIBRARY_PIECES)
			throw new ApiError(
				400,
				`A workspace can keep at most ${MAX_LIBRARY_PIECES} saved custom parts. Delete one first.`
			);
		const plates = piecePlates(tx, userId, buildId, piece);
		if (!plates.length) throw new ApiError(400, 'This custom piece has no plates to save');
		const saved = tx
			.insert(workspaceCustomPieces)
			.values({
				organizationId: access.organizationId,
				name: piece.name,
				fileName: piece.fileName,
				sliced: piece.sliced,
				templateId: loadBuildView(tx, buildId, userId)?.build.templateId ?? null,
				replaces: [...(piece.replaces ?? [])],
				plates,
				isDefault: opts.isDefault === true,
				createdBy: userId
			})
			.returning()
			.get();
		tx.update(buildCustomPieces)
			.set({ libraryId: saved.id })
			.where(eq(buildCustomPieces.id, pieceId))
			.run();
		return saved;
	});
	announce(db, buildId, userId, 'custom.library');
	return toView(row);
}

/**
 * The saved plates with the typed `plates: [{ index, estSeconds?, grams? }]` applied (`index` is the 0-based
 * position; `null` clears a value). A new grams value rescales the plate's per-color grams, or puts them on
 * the plate's color when there are none.
 */
function editedPlates(current: LibraryPlate[], v: unknown): LibraryPlate[] {
	if (!Array.isArray(v) || !v.length || v.length > MAX_CUSTOM_PLATES)
		throw new ApiError(400, 'plates must be a list of plates to change');
	const next = current.map((p) => ({ ...p, filamentGrams: { ...(p.filamentGrams ?? {}) } }));
	const seen = new Set<number>();
	for (const e of v) {
		if (!isObj(e)) throw new ApiError(400, 'Each plate change must be an object');
		const ch = e as Obj;
		const i = ch.index;
		if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= next.length)
			throw new ApiError(400, 'index must be the position of a plate of the saved part');
		if (seen.has(i)) throw new ApiError(400, 'A plate can be listed only once');
		seen.add(i);
		const p = next[i];
		if (ch.estSeconds !== undefined)
			p.estSeconds = ch.estSeconds === null ? null : cleanSeconds(ch.estSeconds, 'estSeconds');
		if (ch.grams !== undefined) {
			if (ch.grams === null) {
				p.grams = null;
				p.filamentGrams = {};
			} else {
				const g = cleanGrams(ch.grams);
				p.grams = g;
				p.filamentGrams = Object.keys(p.filamentGrams).length
					? scaleGrams(p.filamentGrams, g)
					: p.role
						? { [p.role]: g }
						: {};
			}
		}
	}
	return next;
}

/** Rename a saved part, switch "in new builds by default" or correct its plates' time and grams (editors and owners). */
export function updateLibraryPiece(
	db: Db,
	userId: string,
	orgId: string,
	libId: string,
	body: unknown
): LibraryPieceView {
	requireEditor(db, orgId, userId);
	const row = rowOf(db, orgId, libId);
	if (!isObj(body)) throw new ApiError(400, 'Invalid body');
	const b = body as Obj;
	const set: Partial<typeof workspaceCustomPieces.$inferInsert> = {};
	if (b.name !== undefined) set.name = cleanPieceName(b.name);
	if (b.isDefault !== undefined) {
		if (typeof b.isDefault !== 'boolean')
			throw new ApiError(400, 'isDefault must be true or false');
		set.isDefault = b.isDefault;
	}
	if (b.plates !== undefined) set.plates = editedPlates(row.plates ?? [], b.plates);
	if (!Object.keys(set).length) throw new ApiError(400, 'Nothing to update');
	db.update(workspaceCustomPieces).set(set).where(eq(workspaceCustomPieces.id, libId)).run();
	return toView(rowOf(db, orgId, libId));
}

/**
 * Overwrite a saved part from a build's custom piece as it is now (name, file name, per-plate time, grams,
 * color and prints), so a correction made in one build is what new builds get. Editors and owners of the
 * workspace; the build and its piece must belong to the workspace and the piece must be linked to this row.
 * Builds that already have the part are not changed.
 */
export function refreshLibraryPiece(
	db: Db,
	userId: string,
	orgId: string,
	libId: string,
	buildId: string,
	pieceId: string
): LibraryPieceView {
	requireEditor(db, orgId, userId);
	rowOf(db, orgId, libId);
	const access = buildAccess(db, buildId, userId);
	if (!access || access.organizationId !== orgId) throw new ApiError(404, 'Not found');
	if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	if (access.kind === 'draft')
		throw new ApiError(400, 'Drafts have no build tracking. Make it a build first.');
	if (typeof pieceId !== 'string') throw new ApiError(404, 'Custom piece not found');
	const row = db.transaction((txRaw) => {
		const tx = txRaw as unknown as Db;
		const piece = tx
			.select()
			.from(buildCustomPieces)
			.where(and(eq(buildCustomPieces.id, pieceId), eq(buildCustomPieces.buildId, buildId)))
			.get();
		if (!piece) throw new ApiError(404, 'Custom piece not found');
		if (piece.libraryId !== libId)
			throw new ApiError(400, 'This custom part is not linked to that saved part');
		const plates = piecePlates(tx, userId, buildId, piece);
		if (!plates.length) throw new ApiError(400, 'This custom piece has no plates to save');
		return tx
			.update(workspaceCustomPieces)
			.set({ name: piece.name, fileName: piece.fileName, sliced: piece.sliced, plates })
			.where(eq(workspaceCustomPieces.id, libId))
			.returning()
			.get();
	});
	announce(db, buildId, userId, 'custom.library');
	return toView(row);
}

/** Delete a saved part. Builds keep the pieces they already have; their "Saved" mark goes (editors and owners). */
export function deleteLibraryPiece(db: Db, userId: string, orgId: string, libId: string): void {
	requireEditor(db, orgId, userId);
	rowOf(db, orgId, libId);
	const touched = db.transaction((txRaw) => {
		const tx = txRaw as unknown as Db;
		const linked = tx
			.select({ buildId: buildCustomPieces.buildId })
			.from(buildCustomPieces)
			.where(eq(buildCustomPieces.libraryId, libId))
			.all();
		tx.update(buildCustomPieces)
			.set({ libraryId: null })
			.where(eq(buildCustomPieces.libraryId, libId))
			.run();
		tx.delete(workspaceCustomPieces).where(eq(workspaceCustomPieces.id, libId)).run();
		return [...new Set(linked.map((l) => l.buildId))];
	});
	for (const id of touched) announce(db, id, userId, 'custom.library');
}

export interface ApplyLibraryResult {
	pieceId: string;
	/** Numbers of the piece's plates (before any automatic re-arrange). */
	plates: number[];
	/** Kit parts that were marked "Not printing". */
	skipped: string[];
	/** Their names, for messages and the activity row. */
	skippedNames: string[];
}

/**
 * Put a saved part into a build, inside the caller's transaction (no access check on the user, no activity
 * row, no event: `applyLibraryPiece` and `createBuild` add those). Plates are numbered after the highest
 * plate. Roles the build lacks fall back to its first filament role (grams of unknown roles fold into it).
 * Replaced kit parts are marked "Not printing" only when the build's kit is the one the part was saved
 * from, and only those that are active kit parts and not printing; the rest are left alone.
 *
 * Returns null when the build already holds a piece from this saved part (nothing changes). Throws a 404
 * for a saved part of another workspace, a 400 for a draft, for a build without filament colors and when
 * the build's custom piece or plate limits are reached.
 */
export function applyLibraryPieceTx(
	tx: Db,
	view: BuildView,
	lib: LibraryRow,
	userId: string
): ApplyLibraryResult | null {
	if (lib.organizationId !== view.build.organizationId) throw new ApiError(404, 'Not found');
	if (view.build.kind === 'draft')
		throw new ApiError(400, 'Drafts have no build tracking. Make it a build first.');
	if (view.customPieces.some((c) => c.libraryId === lib.id)) return null;
	const libPlates = lib.plates ?? [];
	if (!libPlates.length) throw new ApiError(400, 'This saved part has no plates');
	if (view.customPieces.length >= MAX_CUSTOM_PIECES)
		throw new ApiError(400, `A build can have at most ${MAX_CUSTOM_PIECES} custom pieces`);
	const have = view.customPieces.reduce((n, c) => n + c.plates.length, 0);
	if (have + libPlates.length > MAX_CUSTOM_PLATES)
		throw new ApiError(
			400,
			`A build can have at most ${MAX_CUSTOM_PLATES} custom plates (${have} now, ${libPlates.length} more asked for)`
		);
	const roleKeys = new Set(view.filaments.map((f) => f.key));
	const first = view.filaments[0]?.key;
	if (!first) throw new ApiError(400, 'This build has no filament colours yet');
	const mapRole = (r: string) => (roleKeys.has(r) ? r : first);

	// kit parts it replaces: same kit, active kit parts, not printing; anything else stays as it is
	let replaces: string[] = [];
	if (lib.templateId && lib.templateId === view.build.templateId && (lib.replaces ?? []).length) {
		const live = livePrintingSlugs(tx, view.build.id);
		const kit = new Map(view.parts.filter((p) => !p.custom).map((p) => [p.slug, p]));
		replaces = [...new Set(lib.replaces)].filter(
			(s) => kit.has(s) && view.state[s]?.status !== 'Printing' && !live.has(s)
		);
	}

	const multi = libPlates.length > 1;
	const plates: NewPiecePlate[] = libPlates.map((p, i) => {
		const fg: Record<string, number> = {};
		for (const [role, g] of Object.entries(p.filamentGrams ?? {})) {
			if (!(g > 0)) continue;
			const key = mapRole(role);
			fg[key] = round2((fg[key] ?? 0) + g);
		}
		return {
			label: customPlateLabel(lib.name, p.name, multi, i + 1),
			role: mapRole(p.role),
			// a sliced file's numbers are the file's; for a part saved without one they were typed
			estSeconds: lib.sliced ? p.estSeconds : null,
			manualEstSeconds: lib.sliced ? null : p.estSeconds,
			slicerGrams: p.grams,
			slicerGramsSource: p.grams ? (lib.sliced ? 'file' : 'user') : null,
			filamentGrams: fg,
			runs: p.runs,
			thumbSource: null
		};
	});
	const made = insertCustomPieceTx(
		tx,
		view,
		{
			name: lib.name,
			fileName: lib.fileName,
			sliced: lib.sliced,
			replaces,
			libraryId: lib.id,
			plates
		},
		userId,
		[]
	);
	return made;
}

/**
 * Add a saved part to a build (editors and owners; drafts refuse it). The saved part must belong to the
 * build's workspace. Answers null when the build already has a piece from it.
 */
export function applyLibraryPiece(
	db: Db,
	buildId: string,
	userId: string,
	libId: string
): { pieceId: string; plates: number[]; skipped: string[] } | null {
	let result: ApplyLibraryResult | null = null;
	mutateBuild(db, buildId, userId, (tx, view) => {
		if (view.build.kind === 'draft')
			throw new ApiError(400, 'Drafts have no build tracking. Make it a build first.');
		const lib = rowOf(tx, view.build.organizationId, libId);
		result = applyLibraryPieceTx(tx, view, lib, userId);
		if (!result) return { kind: 'custom.add', payload: {}, skip: true };
		return {
			kind: 'custom.add',
			payload: {
				pieceId: result.pieceId,
				name: lib.name,
				fileName: lib.fileName,
				plates: [],
				sliced: lib.sliced,
				replaced: result.skippedNames,
				fromLibrary: true
			}
		};
	});
	if (!result) return null;
	const r = result as ApplyLibraryResult;
	// A re-arrange right after the add renumbers custom plates: read the final numbers.
	const final = db
		.select({ n: buildPlates.number })
		.from(buildPlates)
		.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.source, `custom:${r.pieceId}`)))
		.all()
		.map((x) => x.n)
		.sort((a, c) => a - c);
	return { pieceId: r.pieceId, plates: final.length ? final : r.plates, skipped: r.skipped };
}

/** Rows marked "in new builds by default" of a workspace, for `createBuild`. */
export function defaultLibraryRows(db: Db, orgId: string): LibraryRow[] {
	return db
		.select()
		.from(workspaceCustomPieces)
		.where(
			and(
				eq(workspaceCustomPieces.organizationId, orgId),
				eq(workspaceCustomPieces.isDefault, true)
			)
		)
		.orderBy(asc(workspaceCustomPieces.createdAt), asc(workspaceCustomPieces.name))
		.all();
}

/** Rows of a workspace by id (ids of other workspaces are left out). */
export function libraryRowsByIds(db: Db, orgId: string, ids: string[]): LibraryRow[] {
	if (!ids.length) return [];
	return db
		.select()
		.from(workspaceCustomPieces)
		.where(
			and(eq(workspaceCustomPieces.organizationId, orgId), inArray(workspaceCustomPieces.id, ids))
		)
		.all();
}
