import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { filamentStats, timeStats } from '#lib/domain/accounting.ts';
import { describeActivity } from '#lib/domain/activity.ts';
import { isCustomPlate } from '#lib/domain/custom.ts';
import type { BuildPrinter } from '#lib/domain/types.ts';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { printerFromCatalog } from '#lib/printers/printer.ts';
import { ApiError } from '../access';
import { removeBuildPlateFiles } from './custom-plates';
import { uploadsDir } from '../config';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildCustomPieces,
	buildParts,
	buildPlates,
	buildUploads,
	member,
	organization,
	printerJobs,
	printers,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { makeProjectThreeMf } from '../threemf/fixtures';
import { parseThreeMfBytes } from '../threemf';
import {
	addRun,
	deleteBuild,
	promoteDraft,
	setPartStatus,
	skipParts,
	updatePlate
} from './actions';
import { addCustomPiece, removeCustomPiece } from './custom-pieces';
import { createBuild } from './create';
import {
	loadKitSource,
	planForBuild,
	placeOnPlates,
	loadFootprints,
	signature
} from './arrange-plan';
import {
	applyUpload,
	arrangeForPrinter,
	buildArrangement,
	createUpload,
	uploadDir,
	plateThumbnailFile,
	setPlateLayout
} from './plates';
import { loadBuildView } from './view';

let db: Db;
let templateId: string;
const orgId = 'org1';
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-custom-')), 'unused.db');

const cc: BuildPrinter = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	for (const [u, role] of [
		['owner', 'owner'],
		['viewer', 'viewer'],
		['outsider', '']
	]) {
		db.insert(user)
			.values({ id: u, name: `User ${u}`, email: `${u}@example.test`, createdAt: new Date() })
			.run();
		if (role)
			db.insert(member)
				.values({ id: `m-${u}`, organizationId: orgId, userId: u, role, createdAt: new Date() })
				.run();
	}
});

const mk = (opts: { printer?: BuildPrinter; plateLayout?: string; kind?: 'draft' } = {}) =>
	createBuild(
		db,
		{ organizationId: orgId, templateId, designId: null, name: 'B', ...opts },
		'owner'
	);
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const customPlates = (id: string) => view(id).plates.filter(isCustomPlate);
const kitPlates = (id: string) => view(id).plates.filter((p) => !isCustomPlate(p));

/** A two-plate sliced file: plate 1 PETG (primary) + TPU, plate 2 PETG only. */
async function upload(id: string, kind: 'sliced' | 'unsliced' = 'sliced', userId = 'owner') {
	const bytes = makeProjectThreeMf({
		sliced: kind === 'sliced',
		filamentTypes: ['PETG', 'TPU'],
		plates:
			kind === 'sliced'
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
	return createUpload(db, id, userId, { name: 'beta.3mf', size: bytes.length }, parsed, view(id));
}
const add = (id: string, uploadId: string, body: Record<string, unknown>, userId = 'owner') =>
	addCustomPiece(db, id, userId, uploadId, body);
const status = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		if (e instanceof ApiError) return e.status;
		throw e;
	}
	return 0;
};

describe('adding a custom piece', () => {
	it('adds the plates of a sliced file after the kit plates with the file time and grams', async () => {
		const id = mk();
		const kitN = kitPlates(id).length;
		const lastKit = Math.max(...kitPlates(id).map((p) => p.number));
		const t0 = timeStats(view(id)).totalSec;
		const g0 = filamentStats(view(id)).reduce((a, f) => a + f.total, 0);
		const up = await upload(id);
		const r = add(id, up.uploadId, {
			name: '  Beta   handle ',
			filamentMap: { '1': 'primary', '2': 'soft' },
			runs: { '2': 2 }
		});
		expect(r.plates).toEqual([lastKit + 1, lastKit + 2]);
		expect(r.skipped).toEqual([]);
		const v = view(id);
		expect(kitPlates(id)).toHaveLength(kitN);
		const [a, b] = customPlates(id);
		expect(a).toMatchObject({
			number: lastKit + 1,
			name: 'Beta handle - HANDLE BAR',
			estSeconds: 7200,
			estSource: 'slicer',
			slicerGrams: 70,
			gramsSource: 'file',
			runs: 1,
			source: `custom:${r.pieceId}`
		});
		expect(a.filamentGrams).toEqual({ primary: 30, soft: 40 });
		expect(b).toMatchObject({ estSeconds: 3600, slicerGrams: 12.5, runs: 2 });
		expect(b.filamentGrams).toEqual({ primary: 12.5 });
		// one part per plate, role carrying most grams, in the Custom section
		expect(v.customPieces).toHaveLength(1);
		const piece = v.customPieces[0];
		expect(piece).toMatchObject({ name: 'Beta handle', fileName: 'beta.3mf', sliced: true });
		expect(piece.parts).toHaveLength(2);
		const parts = piece.parts.map((s) => v.parts.find((p) => p.slug === s)!);
		expect(parts.map((p) => p.role)).toEqual(['soft', 'primary']);
		expect(parts.every((p) => p.section === 'Custom' && /^custom-[0-9a-f]{8}$/.test(p.slug))).toBe(
			true
		);
		expect(v.state[piece.parts[0]].status).toBe('To print');
		// totals rise: 7200 + 2 * 3600 s, 70 + 2 * 12.5 g
		expect(timeStats(v).totalSec - t0).toBe(7200 + 2 * 3600);
		expect(filamentStats(v).reduce((x, f) => x + f.total, 0) - g0).toBeCloseTo(95, 1);
		// activity, and the upload is used up
		const act = db.select().from(activity).where(eq(activity.kind, 'custom.add')).all();
		expect(act).toHaveLength(1);
		expect(
			describeActivity(
				{
					id: 'x',
					userId: 'owner',
					userName: 'Owen',
					kind: 'custom.add',
					payload: act[0].payload,
					at: ''
				},
				v
			)
		).toContain('added the custom piece "Beta handle"');
		expect(
			db.select().from(buildUploads).where(eq(buildUploads.id, up.uploadId)).get()!.status
		).toBe('applied');
		expect(
			status(() => add(id, up.uploadId, { name: 'again', filamentMap: { '1': 'primary' } }))
		).toBe(409);
	});

	it('takes the file thumbnails along and serves them from a recomputed path only', async () => {
		const id = mk();
		const up = await upload(id);
		add(id, up.uploadId, { name: 'Beta', filamentMap: { '1': 'primary', '2': 'soft' } });
		const [a] = customPlates(id);
		const file = plateThumbnailFile(db, id, 'owner', a.number);
		expect(file).toBe(join(uploadsDir(), `plates/${id}/${a.parts[0]}.png`));
		expect(existsSync(file!)).toBe(true);
		// a stored path that is not the recomputed one is never served
		db.update(buildPlates)
			.set({ thumbnailPath: '../../etc/passwd' })
			.where(and(eq(buildPlates.buildId, id), eq(buildPlates.number, a.number)))
			.run();
		expect(plateThumbnailFile(db, id, 'owner', a.number)).toBeNull();
		db.update(buildPlates)
			.set({ thumbnailPath: `plates/${id}/${a.number}.png` })
			.where(and(eq(buildPlates.buildId, id), eq(buildPlates.number, a.number)))
			.run();
		expect(plateThumbnailFile(db, id, 'owner', a.number)).toBeNull();
	});

	it('adds an unsliced file without time or grams; the maker types them on the plate', async () => {
		const id = mk();
		const up = await upload(id, 'unsliced');
		const r = add(id, up.uploadId, { name: 'Cup holder', role: 'accent' });
		const [pl] = customPlates(id);
		expect(r.plates).toEqual([pl.number]);
		expect(pl).toMatchObject({ name: 'Cup holder', estSeconds: null, slicerGrams: null, runs: 1 });
		expect(pl.filamentGrams).toEqual({});
		const v = view(id);
		expect(v.customPieces[0]).toMatchObject({ sliced: false });
		expect(v.parts.find((p) => p.slug === pl.parts[0])!.role).toBe('accent');
		// typed time and grams use the ordinary plate editing
		updatePlate(db, id, 'owner', pl.number, { manualEstSeconds: 5400 });
		expect(customPlates(id)[0]).toMatchObject({ estSeconds: 5400, estSource: 'manual' });
	});

	it('chooses plates, one colour per slot, and the heaviest colour is the part role', async () => {
		const id = mk();
		const up = await upload(id);
		add(id, up.uploadId, {
			name: 'Beta',
			plates: [1],
			filamentMap: { '1': 'accent', '2': 'primary' }
		});
		const [pl] = customPlates(id);
		expect(customPlates(id)).toHaveLength(1);
		expect(pl.name).toBe('Beta'); // one plate: no plate suffix
		expect(pl.filamentGrams).toEqual({ accent: 30, primary: 40 });
		expect(view(id).parts.find((p) => p.slug === pl.parts[0])!.role).toBe('primary');
	});

	it('replaces kit parts (Not printing) and remove with restore brings them back', async () => {
		const id = mk();
		const before = view(id);
		const kitSec = timeStats(before).totalSec;
		const up = await upload(id);
		const r = add(id, up.uploadId, {
			name: 'Beta handle',
			filamentMap: { '1': 'primary', '2': 'soft' },
			replaces: ['handle-left', 'handle-right']
		});
		expect(r.skipped.sort()).toEqual(['handle-left', 'handle-right']);
		let v = view(id);
		expect(v.skipped.map((s) => s.slug).sort()).toEqual(['handle-left', 'handle-right']);
		expect(v.customPieces[0].replaces.sort()).toEqual(['handle-left', 'handle-right']);
		expect(v.parts.some((p) => p.slug === 'handle-left')).toBe(false);
		const act = db.select().from(activity).where(eq(activity.kind, 'custom.add')).all()[0];
		expect((act.payload as { replaced: string[] }).replaced).toHaveLength(2);
		// the plain remove leaves the kit parts out
		const pieceId = r.pieceId;
		const thumb = join(uploadsDir(), `plates/${id}/${v.customPieces[0].parts[0]}.png`);
		expect(existsSync(thumb)).toBe(true);
		removeCustomPiece(db, id, 'owner', pieceId, { restore: false });
		v = view(id);
		expect(v.customPieces).toEqual([]);
		expect(v.skipped).toHaveLength(2);
		expect(existsSync(thumb)).toBe(false);
		expect(customPlates(id)).toEqual([]);
		expect(
			db
				.select()
				.from(buildParts)
				.where(eq(buildParts.buildId, id))
				.all()
				.filter((p) => p.partSlug.startsWith('custom-'))
		).toEqual([]);
		// bring the parts back by hand, add again and restore
		skipParts(db, id, 'owner', { slugs: ['handle-left', 'handle-right'], skip: false });
		const up2 = await upload(id);
		const r2 = add(id, up2.uploadId, {
			name: 'Beta handle',
			filamentMap: { '1': 'primary', '2': 'soft' },
			replaces: ['handle-left']
		});
		const out = removeCustomPiece(db, id, 'owner', r2.pieceId, { restore: true });
		expect(out.restored).toHaveLength(1);
		v = view(id);
		expect(v.skipped).toEqual([]);
		expect(v.parts.some((p) => p.slug === 'handle-left')).toBe(true);
		const rm = db.select().from(activity).where(eq(activity.kind, 'custom.remove')).all();
		expect(rm).toHaveLength(2);
		expect(
			describeActivity(
				{
					id: 'x',
					userId: 'owner',
					userName: 'Owen',
					kind: 'custom.remove',
					payload: rm[1].payload,
					at: ''
				},
				v
			)
		).toContain('brought back');
		expect(
			db.select().from(buildCustomPieces).where(eq(buildCustomPieces.buildId, id)).all()
		).toEqual([]);
		expect(timeStats(view(id)).totalSec).toBe(kitSec);
	});

	it('refuses removal once the piece has print logs or is printing, and says what to do', async () => {
		const id = mk();
		const up = await upload(id);
		const r = add(id, up.uploadId, { name: 'Beta', filamentMap: { '1': 'primary', '2': 'soft' } });
		const piece = view(id).customPieces[0];
		setPartStatus(db, id, 'owner', piece.parts[0], { status: 'Printing' });
		expect(() => removeCustomPiece(db, id, 'owner', r.pieceId)).toThrow(/Not printing/);
		setPartStatus(db, id, 'owner', piece.parts[0], { status: 'To print' });
		addRun(db, id, 'owner', {
			date: '2026-03-01',
			result: 'Success',
			partSlug: piece.parts[1],
			grams: 10
		});
		expect(status(() => removeCustomPiece(db, id, 'owner', r.pieceId))).toBe(409);
		expect(view(id).customPieces).toHaveLength(1);
		// "Not printing" works on a custom part
		skipParts(db, id, 'owner', { slugs: piece.parts, skip: true });
		expect(view(id).skipped.filter((s) => s.custom)).toHaveLength(2);
	});

	it('refuses a replaced part that is printing and leaves nothing behind', async () => {
		const id = mk();
		setPartStatus(db, id, 'owner', 'handle-left', { status: 'Printing' });
		const up = await upload(id);
		expect(
			status(() =>
				add(id, up.uploadId, {
					name: 'Beta',
					filamentMap: { '1': 'primary', '2': 'soft' },
					replaces: ['handle-left']
				})
			)
		).toBe(409);
		expect(customPlates(id)).toEqual([]);
		expect(view(id).customPieces).toEqual([]);
		expect(
			db.select().from(buildUploads).where(eq(buildUploads.id, up.uploadId)).get()!.status
		).toBe('parsed');
		expect(existsSync(join(uploadsDir(), `plates/${id}`))).toBe(false);
	});
});

describe('validation and access', () => {
	it("keeps viewers out, refuses drafts, another build's upload, bad roles and slugs", async () => {
		const id = mk();
		const other = mk();
		const up = await upload(id);
		const ok = { name: 'Beta', filamentMap: { '1': 'primary', '2': 'soft' } };
		expect(status(() => add(id, up.uploadId, ok, 'viewer'))).toBe(403);
		expect(status(() => add(id, up.uploadId, ok, 'outsider'))).toBe(404);
		expect(status(() => add(other, up.uploadId, ok))).toBe(404);
		expect(status(() => add(id, 'nope', ok))).toBe(404);
		expect(status(() => add(id, up.uploadId, { ...ok, name: '   ' }))).toBe(400);
		expect(
			status(() => add(id, up.uploadId, { ...ok, filamentMap: { '1': 'nope', '2': 'soft' } }))
		).toBe(400);
		expect(status(() => add(id, up.uploadId, { ...ok, filamentMap: { '1': 'primary' } }))).toBe(
			400
		); // slot 2 has grams, no colour
		expect(status(() => add(id, up.uploadId, { ...ok, role: 'nope' }))).toBe(400);
		expect(status(() => add(id, up.uploadId, { ...ok, replaces: ['nope'] }))).toBe(400);
		expect(status(() => add(id, up.uploadId, { ...ok, replaces: ['custom-00000000'] }))).toBe(400);
		expect(status(() => add(id, up.uploadId, { ...ok, plates: [9] }))).toBe(400);
		expect(status(() => add(id, up.uploadId, { ...ok, plates: [] }))).toBe(400);
		expect(status(() => add(id, up.uploadId, { ...ok, runs: { '1': 21 } }))).toBe(400);
		expect(status(() => add(id, up.uploadId, { ...ok, runs: { '1': 0 } }))).toBe(400);
		expect(customPlates(id)).toEqual([]);
		// a draft has no build tracking
		const draft = mk({ kind: 'draft' });
		const dup = await upload(draft);
		expect(status(() => add(draft, dup.uploadId, ok))).toBe(400);
		expect(view(draft).customPieces).toEqual([]);
		// control characters and length
		const r = add(id, up.uploadId, {
			...ok,
			name: `a${String.fromCharCode(0)}b${String.fromCharCode(0x202e)}${'x'.repeat(200)}`
		});
		expect(view(id).customPieces[0].name.length).toBeLessThanOrEqual(80);
		const clean = view(id).customPieces[0].name;
		expect([...clean].some((c) => c.charCodeAt(0) === 0 || c.charCodeAt(0) === 0x202e)).toBe(false);
		expect(status(() => removeCustomPiece(db, id, 'viewer', r.pieceId))).toBe(403);
		expect(status(() => removeCustomPiece(db, other, 'owner', r.pieceId))).toBe(404); // another build's piece
		expect(status(() => removeCustomPiece(db, id, 'owner', 'nope'))).toBe(404);
		expect(promoteDraft).toBeTypeOf('function');
	});

	it('caps pieces and plates per build', async () => {
		const id = mk();
		for (let i = 0; i < 15; i++) {
			const up = await upload(id);
			add(id, up.uploadId, { name: `P${i}`, filamentMap: { '1': 'primary', '2': 'soft' } });
		}
		expect(customPlates(id)).toHaveLength(30);
		const up = await upload(id, 'unsliced');
		expect(status(() => add(id, up.uploadId, { name: 'Over', role: 'primary' }))).toBe(400);
		// 20 pieces: remove one, then plates are free again
		const first = view(id).customPieces[0];
		removeCustomPiece(db, id, 'owner', first.id);
		expect(status(() => add(id, up.uploadId, { name: 'Fits', role: 'primary' }))).toBe(0);
	});

	it('numbering: a new piece takes max + 1 and removing one leaves a gap', async () => {
		const id = mk();
		const one = add(id, (await upload(id)).uploadId, {
			name: 'A',
			filamentMap: { '1': 'primary', '2': 'soft' }
		});
		const two = add(id, (await upload(id)).uploadId, {
			name: 'B',
			filamentMap: { '1': 'primary', '2': 'soft' }
		});
		expect(two.plates[0]).toBe(one.plates[1] + 1);
		removeCustomPiece(db, id, 'owner', one.pieceId);
		expect(customPlates(id).map((p) => p.number)).toEqual(two.plates);
		const three = add(id, (await upload(id)).uploadId, {
			name: 'C',
			filamentMap: { '1': 'primary', '2': 'soft' }
		});
		expect(three.plates[0]).toBe(two.plates[1] + 1);
	});
});

describe('custom plates survive every plate replacement', () => {
	async function withPiece(opts: { printer?: BuildPrinter; plateLayout?: string } = {}) {
		const id = mk(opts);
		const up = await upload(id);
		const r = add(id, up.uploadId, { name: 'Beta', filamentMap: { '1': 'primary', '2': 'soft' } });
		const piece = view(id).customPieces[0];
		// time and grams typed by hand, and a run of the custom part
		updatePlate(db, id, 'owner', customPlates(id)[0].number, { manualEstSeconds: 9000 });
		return { id, r, piece };
	}
	const expectKept = (id: string, piece: { id: string; parts: string[] }) => {
		const v = view(id);
		const kit = kitPlates(id);
		const cust = customPlates(id);
		expect(cust).toHaveLength(2);
		expect(cust.map((p) => p.parts)).toEqual(piece.parts.map((s) => [s]));
		expect(Math.min(...cust.map((p) => p.number))).toBeGreaterThan(
			Math.max(...kit.map((p) => p.number))
		);
		expect(cust[0]).toMatchObject({ estSeconds: 9000, estSource: 'manual', slicerGrams: 70 });
		expect(cust[0].thumbnailPath).toBe(`plates/${id}/${piece.parts[0]}.png`);
		expect(existsSync(join(uploadsDir(), cust[0].thumbnailPath!))).toBe(true);
		expect(v.customPieces[0].id).toBe(piece.id);
		expect(v.state[piece.parts[0]]).toBeTruthy();
	};

	it('setPlateLayout', async () => {
		const { id, piece } = await withPiece();
		setPlateLayout(db, id, 'owner', { key: 'h2d' });
		expectKept(id, piece);
		setPlateLayout(db, id, 'owner', { key: 'xpa' });
		expectKept(id, piece);
	});

	it('arrangeForPrinter and the automatic re-arrange after a change', async () => {
		const { id, piece } = await withPiece({ printer: cc });
		arrangeForPrinter(db, id, 'owner');
		expect(kitPlates(id).every((p) => p.source === 'arranged')).toBe(true);
		expectKept(id, piece);
		// a second arrange does not change anything about the piece
		arrangeForPrinter(db, id, 'owner');
		expectKept(id, piece);
		// adding a second piece re-arranges (custom.add is a re-arrange kind) and both stay last
		const up = await upload(id, 'unsliced');
		add(id, up.uploadId, { name: 'Cup', role: 'primary' });
		const v = view(id);
		const nums = v.plates.map((p) => p.number);
		expect(nums).toEqual([...nums].sort((a, b) => a - b));
		expect(v.plates.slice(-3).every(isCustomPlate)).toBe(true);
		expect(v.customPieces).toHaveLength(2);
		expect(buildArrangement(db, id, 'owner').stale).toBe(false);
	});

	it('runs of the custom part stay intact through a re-arrange', async () => {
		const { id, piece } = await withPiece({ printer: cc });
		arrangeForPrinter(db, id, 'owner');
		addRun(db, id, 'owner', {
			date: '2026-03-01',
			result: 'Success',
			partSlug: piece.parts[1],
			grams: 12
		});
		arrangeForPrinter(db, id, 'owner', { confirm: true });
		const v = view(id);
		expect(v.runs.filter((r) => r.partSlug === piece.parts[1])).toHaveLength(1);
		expect(v.state[piece.parts[1]].status).toBe('Printed');
		expect(v.customPieces[0].removable).toBe(false);
	});

	it('a plate-attached log on a custom plate becomes a part log when the plates change', async () => {
		const { id, piece } = await withPiece({ printer: cc });
		arrangeForPrinter(db, id, 'owner');
		const n = customPlates(id)[1].number;
		addRun(db, id, 'owner', { date: '2026-03-01', result: 'Success', plateNumber: n, grams: 12 });
		expect(status(() => arrangeForPrinter(db, id, 'owner', {}))).toBe(409);
		arrangeForPrinter(db, id, 'owner', { convertRuns: true });
		const v = view(id);
		expect(v.runs.every((r) => r.plateNumber == null)).toBe(true);
		expect(v.runs.filter((r) => r.partSlug === piece.parts[1])).toHaveLength(1);
		expect(v.state[piece.parts[1]].status).toBe('Printed');
		expectKept(id, piece);
	});

	async function kitUpload(id: string) {
		const bytes = makeProjectThreeMf({
			sliced: true,
			filamentTypes: ['PETG'],
			plates: [
				{
					name: 'HANDLES',
					prediction: 47000,
					weight: 330,
					filaments: { 1: 330 },
					objects: [{ name: '3DTMT A1 HANDLE LEFT REV A.STEP' }]
				}
			]
		});
		return createUpload(
			db,
			id,
			'owner',
			{ name: 'chair.3mf', size: bytes.length },
			await parseThreeMfBytes(bytes),
			view(id)
		);
	}

	it('applyUpload in plates mode and in template mode', async () => {
		const { id, piece } = await withPiece({ printer: cc });
		const up = await kitUpload(id);
		const key = Object.keys(up.suggestions.mapping)[0];
		applyUpload(db, id, 'owner', up.uploadId, {
			mapping: { [key]: 'handle-left' },
			filamentMap: { '1': 'primary' }
		});
		expect(kitPlates(id).map((p) => p.source)).toEqual([expect.stringMatching(/^upload:/)]);
		expectKept(id, piece);
		expect(customPlates(id)[0].number).toBe(2);
		// template mode with an arrange
		const up2 = await kitUpload(id);
		applyUpload(db, id, 'owner', up2.uploadId, {
			mode: 'template',
			arrange: true,
			mapping: { [key]: 'handle-left' },
			filamentMap: { '1': 'primary' }
		});
		expect(kitPlates(id).every((p) => p.source === 'arranged')).toBe(true);
		expectKept(id, piece);
	});
});

describe('the arranger and the export never see custom pieces', () => {
	it('the plan, its signature and the kit source are the same with and without a piece', async () => {
		const id = mk({ printer: cc });
		arrangeForPrinter(db, id, 'owner');
		const v0 = view(id);
		const fps = loadFootprints(db, v0.build.templateId);
		const plan0 = planForBuild(db, v0, fps, null)!;
		const src0 = loadKitSource(db, v0);
		const placed0 = placeOnPlates(v0, fps, null);
		const up = await upload(id);
		add(id, up.uploadId, { name: 'Beta', filamentMap: { '1': 'primary', '2': 'soft' } });
		const v1 = view(id);
		expect(v1.parts.length).toBeGreaterThan(v0.parts.length);
		const plan1 = planForBuild(db, v1, fps, null)!;
		expect(JSON.stringify(plan1.result)).toBe(JSON.stringify(plan0.result));
		expect(signature(plan1.result.plates)).toBe(signature(plan0.result.plates));
		expect(JSON.stringify(loadKitSource(db, v1))).toBe(JSON.stringify(src0));
		expect(JSON.stringify(placeOnPlates(v1, fps, null))).toBe(JSON.stringify(placed0));
		expect(buildArrangement(db, id, 'owner').stale).toBe(false);
		expect(plan1.unsized.some((s) => s.startsWith('custom-'))).toBe(false);
	});

	it('a part marked Not printing is not arranged', () => {
		const id = mk({ printer: cc });
		const slugsOn = (v: ReturnType<typeof view>) =>
			planForBuild(db, v, loadFootprints(db, v.build.templateId), null)!.result.plates.flatMap(
				(p) => p.parts
			);
		expect(slugsOn(view(id))).toContain('handle-left');
		skipParts(db, id, 'owner', { slugs: ['handle-left'], skip: true });
		expect(slugsOn(view(id))).not.toContain('handle-left');
		// arranged plates re-arrange as after a variant change
		arrangeForPrinter(db, id, 'owner');
		skipParts(db, id, 'owner', { slugs: ['handle-right'], skip: true });
		expect(kitPlates(id).flatMap((p) => p.parts)).not.toContain('handle-right');
		expect(printers).toBeTruthy();
		expect(printerJobs).toBeTruthy();
	});
});

describe('safety', () => {
	it('a filament id from the file that is an inherited member name is not a colour', async () => {
		const id = mk();
		const bytes = makeProjectThreeMf({
			sliced: true,
			filamentTypes: ['PETG'],
			plates: [
				{ name: 'P', prediction: 100, weight: 5, filaments: { 1: 5 }, objects: [{ name: 'x' }] }
			]
		});
		const parsed = await parseThreeMfBytes(bytes);
		parsed.plates[0].filamentGrams = { constructor: 5, __proto__x: 1 } as Record<string, number>;
		const up = createUpload(
			db,
			id,
			'owner',
			{ name: 'a.3mf', size: bytes.length },
			parsed,
			view(id)
		);
		for (const fm of [{}, { '1': 'primary' }]) {
			expect(status(() => add(id, up.uploadId, { name: 'X', filamentMap: fm }))).toBe(400);
		}
		expect(
			status(() => add(id, up.uploadId, { name: 'X', filamentMap: { constructor: 'toString' } }))
		).toBe(400);
		expect(customPlates(id)).toEqual([]);
		expect(view(id).customPieces).toEqual([]);
		expect(
			db.select().from(buildUploads).where(eq(buildUploads.id, up.uploadId)).get()!.status
		).toBe('parsed');
	});

	it('a failed add leaves the parsed upload in place and usable', async () => {
		const draft = mk({ kind: 'draft' });
		const up = await upload(draft);
		expect(
			status(() =>
				add(draft, up.uploadId, { name: 'X', filamentMap: { '1': 'primary', '2': 'soft' } })
			)
		).toBe(400);
		expect(existsSync(uploadDir(up.uploadId))).toBe(true);
		expect(
			db.select().from(buildUploads).where(eq(buildUploads.id, up.uploadId)).get()!.status
		).toBe('parsed');
		promoteDraft(db, draft, 'owner');
		add(draft, up.uploadId, { name: 'X', filamentMap: { '1': 'primary', '2': 'soft' } });
		expect(view(draft).customPieces).toHaveLength(1);
		expect(existsSync(uploadDir(up.uploadId))).toBe(false);
	});

	it('deleting a build removes its plate thumbnails, custom ones included', async () => {
		const id = mk();
		const other = mk();
		add(id, (await upload(id)).uploadId, {
			name: 'A',
			filamentMap: { '1': 'primary', '2': 'soft' }
		});
		add(other, (await upload(other)).uploadId, {
			name: 'B',
			filamentMap: { '1': 'primary', '2': 'soft' }
		});
		const dir = join(uploadsDir(), 'plates', id);
		expect(existsSync(dir)).toBe(true);
		deleteBuild(db, id, 'owner');
		removeBuildPlateFiles(id);
		expect(existsSync(dir)).toBe(false);
		expect(existsSync(join(uploadsDir(), 'plates', other))).toBe(true);
	});
});
