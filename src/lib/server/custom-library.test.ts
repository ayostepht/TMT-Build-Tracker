import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { MAX_CUSTOM_PIECES, MAX_CUSTOM_PLATES, isCustomPlate } from '#lib/domain/custom.ts';
import { describeActivity } from '#lib/domain/activity.ts';
import { ApiError } from './access';
import { openDb, runMigrations, type Db } from './db';
import {
	activity,
	buildCustomPieces,
	member,
	organization,
	templates,
	user,
	workspaceCustomPieces,
	type LibraryPlate
} from './db/schema';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';
import { makeProjectThreeMf } from './threemf/fixtures';
import { parseThreeMfBytes } from './threemf';
import { setPartStatus, skipParts, updatePlate } from './builds/actions';
import { addCustomPiece, renameCustomPiece } from './builds/custom-pieces';
import { createBuild } from './builds/create';
import { createUpload } from './builds/plates';
import { loadBuildView } from './builds/view';
import {
	MAX_LIBRARY_PIECES,
	applyLibraryPiece,
	applyLibraryPieceTx,
	deleteLibraryPiece,
	listLibrary,
	refreshLibraryPiece,
	saveToLibrary,
	updateLibraryPiece
} from './custom-library';
import { exportAccountData } from './account';

let db: Db;
let templateId: string;
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-lib-')), 'unused.db');

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	for (const o of ['org1', 'org2'])
		db.insert(organization)
			.values({ id: o, name: `Chapter ${o}`, slug: o, createdAt: new Date() })
			.run();
	for (const [u, o, role] of [
		['owner', 'org1', 'owner'],
		['viewer', 'org1', 'viewer'],
		['outsider', '', ''],
		['other', 'org2', 'owner']
	]) {
		db.insert(user)
			.values({ id: u, name: `User ${u}`, email: `${u}@example.test`, createdAt: new Date() })
			.run();
		if (role)
			db.insert(member)
				.values({ id: `m-${u}`, organizationId: o, userId: u, role, createdAt: new Date() })
				.run();
	}
});

const mk = (org = 'org1', user = 'owner', kind?: 'draft') =>
	createBuild(db, { organizationId: org, templateId, designId: null, name: 'B', kind }, user);
const view = (id: string, user = 'owner') => loadBuildView(db, id, user)!;
const customPlates = (id: string) => view(id).plates.filter(isCustomPlate);
const status = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		if (e instanceof ApiError) return e.status;
		throw e;
	}
	return 0;
};

/** A two-plate sliced file (PETG primary + TPU on plate 1) added as a piece; returns the piece id. */
async function addPiece(
	buildId: string,
	opts: { sliced?: boolean; replaces?: string[]; name?: string } = {}
) {
	const sliced = opts.sliced ?? true;
	const bytes = makeProjectThreeMf({
		sliced,
		filamentTypes: ['PETG', 'TPU'],
		plates: sliced
			? [
					{
						name: 'HANDLE BAR',
						prediction: 7200,
						weight: 70,
						filaments: { 1: 30, 2: 40 },
						objects: [{ name: 'Beta handle bar' }]
					},
					{
						name: 'HANDLE GRIP',
						prediction: 3600,
						weight: 12.5,
						filaments: { 1: 12.5 },
						objects: [{ name: 'Beta handle grip' }]
					}
				]
			: [{ name: 'CUP', objects: [{ name: 'Cup holder' }] }]
	});
	const parsed = await parseThreeMfBytes(bytes);
	const up = createUpload(
		db,
		buildId,
		'owner',
		{ name: 'beta.3mf', size: bytes.length },
		parsed,
		view(buildId)
	);
	return addCustomPiece(db, buildId, 'owner', up.uploadId, {
		name: opts.name ?? 'Beta handle',
		filamentMap: { '1': 'primary', '2': 'soft' },
		role: 'primary',
		runs: { '2': 2 },
		replaces: opts.replaces ?? []
	});
}

const libRow = (id: string) =>
	db.select().from(workspaceCustomPieces).where(eq(workspaceCustomPieces.id, id)).get()!;
const row = (over: Partial<typeof workspaceCustomPieces.$inferInsert> = {}) =>
	db
		.insert(workspaceCustomPieces)
		.values({
			organizationId: 'org1',
			name: 'Row',
			sliced: true,
			templateId,
			plates: [
				{
					name: 'P',
					estSeconds: 600,
					grams: 5,
					filamentGrams: { primary: 5 },
					role: 'primary',
					runs: 1,
					thumb: false
				}
			] as LibraryPlate[],
			...over
		})
		.returning()
		.get();

describe('saving to the library', () => {
	it('stores the plate summaries of a piece and links the piece', async () => {
		const id = mk();
		const p = await addPiece(id, { replaces: ['handle-left'] });
		const saved = saveToLibrary(db, 'owner', id, p.pieceId, { isDefault: true });
		expect(saved).toMatchObject({
			name: 'Beta handle',
			fileName: 'beta.3mf',
			sliced: true,
			templateId,
			replaces: ['handle-left'],
			isDefault: true,
			totalSeconds: 7200 + 2 * 3600,
			totalGrams: 70 + 2 * 12.5
		});
		expect(saved.plates).toEqual([
			{ index: 0, name: 'HANDLE BAR', estSeconds: 7200, grams: 70, role: 'soft', runs: 1 },
			{ index: 1, name: 'HANDLE GRIP', estSeconds: 3600, grams: 12.5, role: 'primary', runs: 2 }
		]);
		expect(saved).not.toHaveProperty('createdBy');
		const r = libRow(saved.id);
		expect(r.organizationId).toBe('org1');
		expect(r.createdBy).toBe('owner');
		expect(r.plates[0]).toMatchObject({ filamentGrams: { primary: 30, soft: 40 }, thumb: false });
		expect(view(id).customPieces[0].libraryId).toBe(saved.id);
	});

	it('prefers a typed time over the file time', async () => {
		const id = mk();
		const p = await addPiece(id);
		updatePlate(db, id, 'owner', customPlates(id)[0].number, { manualEstSeconds: 5400 });
		const saved = saveToLibrary(db, 'owner', id, p.pieceId);
		expect(saved.plates[0].estSeconds).toBe(5400);
		expect(saved.plates[1].estSeconds).toBe(3600);
		expect(saved.isDefault).toBe(false);
	});

	it('is idempotent for a piece that is already linked', async () => {
		const id = mk();
		const p = await addPiece(id);
		const a = saveToLibrary(db, 'owner', id, p.pieceId);
		const b = saveToLibrary(db, 'owner', id, p.pieceId, { isDefault: true });
		expect(b.id).toBe(a.id);
		expect(b.isDefault).toBe(false);
		expect(db.select().from(workspaceCustomPieces).all()).toHaveLength(1);
	});

	it('refuses past the cap of the workspace', async () => {
		const id = mk();
		const p = await addPiece(id);
		for (let i = 0; i < MAX_LIBRARY_PIECES; i++) row({ name: `R${i}` });
		expect(status(() => saveToLibrary(db, 'owner', id, p.pieceId))).toBe(400);
		// another workspace has its own room
		const o2 = mk('org2', 'other');
		const p2 = await addPieceAs(o2, 'other');
		expect(saveToLibrary(db, 'other', o2, p2.pieceId).name).toBe('Beta handle');
	});

	it('needs an editor; viewers get 403, outsiders 404, drafts 400, a foreign piece id 404', async () => {
		const id = mk();
		const p = await addPiece(id);
		expect(status(() => saveToLibrary(db, 'viewer', id, p.pieceId))).toBe(403);
		expect(status(() => saveToLibrary(db, 'outsider', id, p.pieceId))).toBe(404);
		expect(status(() => saveToLibrary(db, 'owner', id, 'nope'))).toBe(404);
		const other = mk();
		expect(status(() => saveToLibrary(db, 'owner', other, p.pieceId))).toBe(404);
		const draft = mk('org1', 'owner', 'draft');
		expect(status(() => saveToLibrary(db, 'owner', draft, p.pieceId))).toBe(400);
	});
});

/** `addPiece` for a build of another workspace's owner. */
async function addPieceAs(buildId: string, userId: string) {
	const bytes = makeProjectThreeMf({
		sliced: true,
		filamentTypes: ['PETG'],
		plates: [
			{ name: 'X', prediction: 600, weight: 5, filaments: { 1: 5 }, objects: [{ name: 'X' }] }
		]
	});
	const parsed = await parseThreeMfBytes(bytes);
	const up = createUpload(
		db,
		buildId,
		userId,
		{ name: 'beta.3mf', size: bytes.length },
		parsed,
		view(buildId, userId)
	);
	return addCustomPiece(db, buildId, userId, up.uploadId, {
		name: 'Beta handle',
		filamentMap: { '1': 'primary' }
	});
}

describe('listing, renaming and deleting', () => {
	it('lists for members only', async () => {
		const id = mk();
		const p = await addPiece(id);
		saveToLibrary(db, 'owner', id, p.pieceId);
		expect(listLibrary(db, 'org1', 'owner')).toHaveLength(1);
		expect(listLibrary(db, 'org1', 'viewer')).toHaveLength(1);
		expect(status(() => listLibrary(db, 'org1', 'outsider'))).toBe(404);
		expect(status(() => listLibrary(db, 'org1', 'other'))).toBe(404);
		expect(listLibrary(db, 'org2', 'other')).toEqual([]);
	});

	it('updates for editors only, within the workspace', () => {
		const r = row();
		const u = updateLibraryPiece(db, 'owner', 'org1', r.id, {
			name: '  New   name ',
			isDefault: true
		});
		expect(u).toMatchObject({ name: 'New name', isDefault: true });
		expect(status(() => updateLibraryPiece(db, 'viewer', 'org1', r.id, { name: 'x' }))).toBe(403);
		expect(status(() => updateLibraryPiece(db, 'outsider', 'org1', r.id, { name: 'x' }))).toBe(404);
		expect(status(() => updateLibraryPiece(db, 'other', 'org2', r.id, { name: 'x' }))).toBe(404);
		expect(status(() => updateLibraryPiece(db, 'other', 'org1', r.id, { name: 'x' }))).toBe(404);
		expect(status(() => updateLibraryPiece(db, 'owner', 'org1', r.id, {}))).toBe(400);
		expect(status(() => updateLibraryPiece(db, 'owner', 'org1', r.id, { name: '  ' }))).toBe(400);
		expect(status(() => updateLibraryPiece(db, 'owner', 'org1', r.id, { isDefault: 'yes' }))).toBe(
			400
		);
		expect(libRow(r.id).name).toBe('New name');
	});

	it('delete unlinks the pieces but builds keep them', async () => {
		const id = mk();
		const p = await addPiece(id);
		const saved = saveToLibrary(db, 'owner', id, p.pieceId);
		expect(status(() => deleteLibraryPiece(db, 'viewer', 'org1', saved.id))).toBe(403);
		expect(status(() => deleteLibraryPiece(db, 'other', 'org2', saved.id))).toBe(404);
		deleteLibraryPiece(db, 'owner', 'org1', saved.id);
		expect(db.select().from(workspaceCustomPieces).all()).toEqual([]);
		const v = view(id);
		expect(v.customPieces).toHaveLength(1);
		expect(v.customPieces[0].libraryId).toBeNull();
		expect(customPlates(id)).toHaveLength(2);
		// it can be saved again
		expect(saveToLibrary(db, 'owner', id, p.pieceId).id).not.toBe(saved.id);
	});
});

describe('adding a saved part to a build', () => {
	it('brings plates, time, grams and roles as saved, without a thumbnail', async () => {
		const src = mk();
		const p = await addPiece(src);
		updatePlate(db, src, 'owner', customPlates(src)[0].number, { manualEstSeconds: 5400 });
		const saved = saveToLibrary(db, 'owner', src, p.pieceId);
		const id = mk();
		const lastKit = Math.max(...view(id).plates.map((x) => x.number));
		const r = applyLibraryPiece(db, id, 'owner', saved.id)!;
		expect(r.plates).toEqual([lastKit + 1, lastKit + 2]);
		expect(r.skipped).toEqual([]);
		const [a, b] = customPlates(id);
		expect(a).toMatchObject({
			name: 'Beta handle - HANDLE BAR',
			estSeconds: 5400,
			slicerGrams: 70,
			runs: 1,
			thumbnailPath: null,
			source: `custom:${r.pieceId}`
		});
		expect(a.filamentGrams).toEqual({ primary: 30, soft: 40 });
		expect(b).toMatchObject({ estSeconds: 3600, slicerGrams: 12.5, runs: 2 });
		const piece = view(id).customPieces[0];
		expect(piece).toMatchObject({ name: 'Beta handle', libraryId: saved.id, sliced: true });
		const act = db.select().from(activity).where(eq(activity.buildId, id)).all();
		const add = act.find((x) => x.kind === 'custom.add')!;
		expect(add.payload).toMatchObject({ fromLibrary: true, plates: [] });
		expect(
			describeActivity(
				{
					id: 'x',
					userId: 'owner',
					userName: 'Owen',
					kind: 'custom.add',
					payload: add.payload as Record<string, unknown>,
					at: ''
				},
				view(id)
			)
		).toContain('Beta handle');
	});

	it('is idempotent per library row', async () => {
		const id = mk();
		const saved = row();
		expect(applyLibraryPiece(db, id, 'owner', saved.id)).not.toBeNull();
		const n = customPlates(id).length;
		expect(applyLibraryPiece(db, id, 'owner', saved.id)).toBeNull();
		expect(view(id).customPieces).toHaveLength(1);
		expect(customPlates(id)).toHaveLength(n);
		expect(db.select().from(activity).where(eq(activity.kind, 'custom.add')).all()).toHaveLength(1);
	});

	it('falls back to the first role for roles the build lacks and folds their grams', () => {
		const id = mk();
		const first = view(id).filaments[0].key;
		const saved = row({
			plates: [
				{
					name: 'P',
					estSeconds: 600,
					grams: 9,
					filamentGrams: { gone: 4, other: 5 },
					role: 'gone',
					runs: 1,
					thumb: false
				}
			]
		});
		applyLibraryPiece(db, id, 'owner', saved.id);
		expect(customPlates(id)[0].filamentGrams).toEqual({ [first]: 9 });
		const part = view(id).parts.find((p) => p.custom)!;
		expect(part.role).toBe(first);
	});

	it('replaces kit parts only for the same kit, only active ones that are not printing', async () => {
		const src = mk();
		const p = await addPiece(src, { replaces: ['handle-left', 'handle-right'] });
		const saved = saveToLibrary(db, 'owner', src, p.pieceId);
		// same kit, one of the parts printing: it is left alone, the other is replaced
		const a = mk();
		setPartStatus(db, a, 'owner', 'handle-left', { status: 'Printing' });
		const r = applyLibraryPiece(db, a, 'owner', saved.id)!;
		expect(r.skipped).toEqual(['handle-right']);
		expect(view(a).skipped.map((s) => s.slug)).toEqual(['handle-right']);
		expect(view(a).customPieces[0].replaces).toEqual(['handle-right']);
		// another kit: nothing is replaced
		db.update(workspaceCustomPieces)
			.set({ templateId: 'another-kit' })
			.where(eq(workspaceCustomPieces.id, saved.id))
			.run();
		const b = mk();
		expect(applyLibraryPiece(db, b, 'owner', saved.id)!.skipped).toEqual([]);
		expect(view(b).skipped).toEqual([]);
		// a slug that is no kit part any more is ignored
		db.update(workspaceCustomPieces)
			.set({ templateId, replaces: ['handle-left', 'no-such-part', 'custom-00000000'] })
			.where(eq(workspaceCustomPieces.id, saved.id))
			.run();
		const c = mk();
		expect(applyLibraryPiece(db, c, 'owner', saved.id)!.skipped).toEqual(['handle-left']);
		// already skipped parts are not an error
		const d = mk();
		skipParts(db, d, 'owner', { slugs: ['handle-left'], skip: true });
		expect(applyLibraryPiece(db, d, 'owner', saved.id)!.skipped).toEqual([]);
	});

	it('keeps typed numbers of a part saved without a file', async () => {
		const src = mk();
		const p = await addPiece(src, { sliced: false });
		updatePlate(db, src, 'owner', customPlates(src)[0].number, {
			manualEstSeconds: 1800,
			slicerGrams: 20
		});
		const saved = saveToLibrary(db, 'owner', src, p.pieceId);
		expect(saved).toMatchObject({ sliced: false, totalSeconds: 1800, totalGrams: 20 });
		const id = mk();
		applyLibraryPiece(db, id, 'owner', saved.id);
		expect(customPlates(id)[0]).toMatchObject({
			estSeconds: 1800,
			estSource: 'manual',
			slicerGrams: 20,
			gramsSource: 'user'
		});
	});

	it('respects the build limits', () => {
		const id = mk();
		const rows = Array.from({ length: MAX_CUSTOM_PIECES + 1 }, (_, i) => row({ name: `R${i}` }));
		for (let i = 0; i < MAX_CUSTOM_PIECES; i++) applyLibraryPiece(db, id, 'owner', rows[i].id);
		expect(status(() => applyLibraryPiece(db, id, 'owner', rows[MAX_CUSTOM_PIECES].id))).toBe(400);
		expect(view(id).customPieces).toHaveLength(MAX_CUSTOM_PIECES);
		const big = row({
			name: 'Big',
			plates: Array.from({ length: MAX_CUSTOM_PLATES + 1 }, (_, i) => ({
				name: `P${i}`,
				estSeconds: 60,
				grams: 1,
				filamentGrams: {},
				role: 'primary',
				runs: 1,
				thumb: false
			}))
		});
		expect(status(() => applyLibraryPiece(db, mk(), 'owner', big.id))).toBe(400);
	});

	it('refuses drafts, viewers and ids of another workspace', () => {
		const saved = row();
		expect(
			status(() => applyLibraryPiece(db, mk('org1', 'owner', 'draft'), 'owner', saved.id))
		).toBe(400);
		expect(status(() => applyLibraryPiece(db, mk(), 'viewer', saved.id))).toBe(403);
		expect(status(() => applyLibraryPiece(db, mk(), 'outsider', saved.id))).toBe(404);
		expect(status(() => applyLibraryPiece(db, mk(), 'owner', 'missing'))).toBe(404);
		const o2 = mk('org2', 'other');
		expect(status(() => applyLibraryPiece(db, o2, 'other', saved.id))).toBe(404);
		expect(view(o2, 'other').customPieces).toEqual([]);
		expect(
			status(() =>
				db.transaction((tx) =>
					applyLibraryPieceTx(tx as unknown as Db, view(o2, 'other'), saved, 'other')
				)
			)
		).toBe(404);
	});

	it('rolls back with an outer transaction', () => {
		const id = mk();
		const saved = row();
		const before = customPlates(id).length;
		expect(() =>
			db.transaction((txRaw) => {
				const tx = txRaw as unknown as Db;
				const r = applyLibraryPieceTx(tx, loadBuildView(tx, id, 'owner')!, saved, 'owner');
				expect(r).not.toBeNull();
				expect(loadBuildView(tx, id, 'owner')!.customPieces).toHaveLength(1);
				throw new Error('abort');
			})
		).toThrow('abort');
		expect(view(id).customPieces).toEqual([]);
		expect(customPlates(id)).toHaveLength(before);
		expect(db.select().from(buildCustomPieces).all()).toEqual([]);
	});
});

describe('account export', () => {
	it('contains the saved parts per workspace', () => {
		row({ name: 'Cup holder', isDefault: true });
		const data = JSON.parse(exportAccountData(db, 'owner')) as {
			customPieces: { workspace: string; parts: { name: string; isDefault: boolean }[] }[];
		};
		expect(data.customPieces).toEqual([
			{
				workspace: 'Chapter org1',
				parts: [expect.objectContaining({ name: 'Cup holder', isDefault: true })]
			}
		]);
	});
});

/** An unsliced file added with typed numbers. */
async function addTyped(buildId: string, extra: Record<string, unknown> = {}) {
	const bytes = makeProjectThreeMf({
		plates: [{ name: 'CUP', objects: [{ name: 'Cup holder' }] }]
	});
	const parsed = await parseThreeMfBytes(bytes);
	const up = createUpload(
		db,
		buildId,
		'owner',
		{ name: 'cup.3mf', size: bytes.length },
		parsed,
		view(buildId)
	);
	return addCustomPiece(db, buildId, 'owner', up.uploadId, {
		name: 'Cup holder',
		role: 'accent',
		...extra
	});
}

describe('typed numbers stick for reuse', () => {
	it('saving keeps what was typed when adding, and a new build gets it', async () => {
		const id = mk();
		const p = await addTyped(id, { times: { '1': 5400 }, grams: { '1': 42.5 }, runs: { '1': 2 } });
		const saved = saveToLibrary(db, 'owner', id, p.pieceId);
		expect(saved).toMatchObject({ sliced: false, totalSeconds: 10800, totalGrams: 85 });
		expect(saved.plates[0]).toMatchObject({
			index: 0,
			estSeconds: 5400,
			grams: 42.5,
			role: 'accent',
			runs: 2
		});
		const next = mk();
		applyLibraryPiece(db, next, 'owner', saved.id);
		expect(customPlates(next)[0]).toMatchObject({
			estSeconds: 5400,
			estSource: 'manual',
			slicerGrams: 42.5,
			gramsSource: 'user'
		});
	});

	it('updating plates: time, grams rescale per color, grams on the role when empty, null clears', () => {
		const r = row({
			plates: [
				{
					name: 'A',
					estSeconds: 600,
					grams: 10,
					filamentGrams: { primary: 4, soft: 6 },
					role: 'primary',
					runs: 1,
					thumb: false
				},
				{
					name: 'B',
					estSeconds: null,
					grams: null,
					filamentGrams: {},
					role: 'accent',
					runs: 2,
					thumb: false
				}
			] as LibraryPlate[]
		});
		const u = updateLibraryPiece(db, 'owner', 'org1', r.id, {
			plates: [
				{ index: 0, estSeconds: 7200, grams: 20 },
				{ index: 1, grams: 33.333 }
			]
		});
		expect(u.plates[0]).toMatchObject({ index: 0, estSeconds: 7200, grams: 20, runs: 1 });
		expect(u.plates[1]).toMatchObject({ index: 1, estSeconds: null, grams: 33.33, role: 'accent' });
		expect(libRow(r.id).plates[0].filamentGrams).toEqual({ primary: 8, soft: 12 });
		expect(libRow(r.id).plates[1].filamentGrams).toEqual({ accent: 33.33 });
		expect(u.totalGrams).toBeCloseTo(20 + 2 * 33.33, 2);
		const c = updateLibraryPiece(db, 'owner', 'org1', r.id, {
			plates: [{ index: 0, estSeconds: null, grams: null }]
		});
		expect(c.plates[0]).toMatchObject({ estSeconds: null, grams: null });
		expect(libRow(r.id).plates[0].filamentGrams).toEqual({});
	});

	it('updating plates is checked: bounds, shape, duplicates, roles and workspaces', () => {
		const r = row();
		const upd = (plates: unknown, user = 'owner', org = 'org1') =>
			status(() => updateLibraryPiece(db, user, org, r.id, { plates }));
		expect(upd([{ index: 0, estSeconds: 0 }])).toBe(400);
		expect(upd([{ index: 0, estSeconds: 2_592_001 }])).toBe(400);
		expect(upd([{ index: 0, grams: 0 }])).toBe(400);
		expect(upd([{ index: 0, grams: 20001 }])).toBe(400);
		expect(upd([{ index: 0, grams: '5' }])).toBe(400);
		expect(upd([{ index: 1, grams: 5 }])).toBe(400);
		expect(upd([{ index: -1, grams: 5 }])).toBe(400);
		expect(upd([{ index: 0.5, grams: 5 }])).toBe(400);
		expect(
			upd([
				{ index: 0, grams: 5 },
				{ index: 0, grams: 6 }
			])
		).toBe(400);
		expect(upd([])).toBe(400);
		expect(upd('x')).toBe(400);
		expect(upd([null])).toBe(400);
		expect(upd([{ index: 0, grams: 5 }], 'viewer')).toBe(403);
		expect(upd([{ index: 0, grams: 5 }], 'other', 'org2')).toBe(404);
		expect(upd([{ index: 0, grams: 5 }], 'outsider')).toBe(404);
		expect(libRow(r.id).plates[0]).toMatchObject({ estSeconds: 600, grams: 5 });
	});
});

describe('refreshing a saved part from a build', () => {
	it('overwrites name, time, grams and prints with the build piece as it is now', async () => {
		const id = mk();
		const p = await addPiece(id);
		const saved = saveToLibrary(db, 'owner', id, p.pieceId);
		const [pl] = customPlates(id);
		updatePlate(db, id, 'owner', pl.number, { manualEstSeconds: 9000, slicerGrams: 50 });
		renameCustomPiece(db, id, 'owner', p.pieceId, { name: 'Beta handle v2' });
		// nothing changes until the maker updates the saved part
		expect(libRow(saved.id).name).toBe('Beta handle');
		const r = refreshLibraryPiece(db, 'owner', 'org1', saved.id, id, p.pieceId);
		expect(r.name).toBe('Beta handle v2');
		expect(r.plates[0]).toMatchObject({ name: 'HANDLE BAR', estSeconds: 9000, grams: 50 });
		expect(r.plates[1]).toMatchObject({
			name: 'HANDLE GRIP',
			estSeconds: 3600,
			grams: 12.5,
			runs: 2
		});
		expect(libRow(saved.id).name).toBe('Beta handle v2');
		// the next build gets the corrected values; the first build is as it was
		const next = mk();
		applyLibraryPiece(db, next, 'owner', saved.id);
		expect(customPlates(next).map((x) => x.name)).toEqual([
			'Beta handle v2 - HANDLE BAR',
			'Beta handle v2 - HANDLE GRIP'
		]);
		expect(customPlates(next)[0].slicerGrams).toBe(50);
		expect(db.select().from(workspaceCustomPieces).all()).toHaveLength(1);
	});

	it('is refused for viewers, outsiders, drafts, unlinked or foreign pieces and other workspaces', async () => {
		const id = mk();
		const p = await addPiece(id);
		const saved = saveToLibrary(db, 'owner', id, p.pieceId);
		const go = (user = 'owner', org = 'org1', lib = saved.id, build = id, piece = p.pieceId) =>
			status(() => refreshLibraryPiece(db, user, org, lib, build, piece));
		expect(go('viewer')).toBe(403);
		expect(go('outsider')).toBe(404);
		expect(go('other', 'org2')).toBe(404); // the row is another workspace's
		expect(go('other', 'org2', saved.id, mk('org2', 'other'))).toBe(404);
		expect(go('owner', 'org1', 'nope')).toBe(404);
		expect(go('owner', 'org1', saved.id, 'nope')).toBe(404);
		expect(go('owner', 'org1', saved.id, id, 'nope')).toBe(404);
		// a piece of another build of the workspace
		expect(go('owner', 'org1', saved.id, mk())).toBe(404);
		// a piece linked to a different saved part, or to none
		const other = row({ name: 'Other' });
		expect(go('owner', 'org1', other.id)).toBe(400);
		const free = await addPiece(id, { name: 'Free' });
		expect(go('owner', 'org1', saved.id, id, free.pieceId)).toBe(400);
		// a build of another workspace under this workspace's row
		const o2 = mk('org2', 'other');
		const p2 = await addPieceAs(o2, 'other');
		expect(go('owner', 'org1', saved.id, o2, p2.pieceId)).toBe(404);
		expect(libRow(saved.id).name).toBe('Beta handle');
	});

	it('refuses a draft build', async () => {
		const id = mk();
		const p = await addPiece(id);
		const saved = saveToLibrary(db, 'owner', id, p.pieceId);
		const draft = mk('org1', 'owner', 'draft');
		expect(status(() => refreshLibraryPiece(db, 'owner', 'org1', saved.id, draft, p.pieceId))).toBe(
			400
		);
	});
});
