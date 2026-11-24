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
	buildFilaments,
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
import { subscribeBuildEvents } from '../events';
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
import {
	addCustomPiece,
	patchCustomPiece,
	recolorCustomPiece,
	rekeyRoles,
	removeCustomPiece,
	renameCustomPiece
} from './custom-pieces';
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
	it("keeps viewers out, another build's upload, bad roles and slugs", async () => {
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
		// a draft takes custom pieces like a build, with the same role checks
		const draft = mk({ kind: 'draft' });
		const dup = await upload(draft);
		expect(status(() => add(draft, dup.uploadId, ok, 'viewer'))).toBe(403);
		expect(status(() => add(draft, dup.uploadId, ok, 'outsider'))).toBe(404);
		expect(status(() => add(draft, dup.uploadId, { ...ok, role: 'nope' }))).toBe(400);
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
		const id = mk();
		const up = await upload(id);
		expect(status(() => add(id, up.uploadId, { name: 'X', filamentMap: { '1': 'nope' } }))).toBe(
			400
		);
		expect(existsSync(uploadDir(up.uploadId))).toBe(true);
		expect(
			db.select().from(buildUploads).where(eq(buildUploads.id, up.uploadId)).get()!.status
		).toBe('parsed');
		add(id, up.uploadId, { name: 'X', filamentMap: { '1': 'primary', '2': 'soft' } });
		expect(view(id).customPieces).toHaveLength(1);
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

describe('text taken from the file', () => {
	it('plate names and the file name are cleaned and capped; longer stored names still load and rename', async () => {
		const id = mk();
		const bytes = makeProjectThreeMf({
			sliced: true,
			filamentTypes: ['PETG'],
			plates: [
				{
					name: `${'A'.repeat(300)}${String.fromCharCode(7)}\u202eZ`,
					prediction: 600,
					weight: 5,
					filaments: { 1: 5 },
					objects: [{ name: 'x' }]
				},
				{ name: 'B', prediction: 600, weight: 5, filaments: { 1: 5 }, objects: [{ name: 'y' }] }
			]
		});
		const up = createUpload(
			db,
			id,
			'owner',
			{ name: `${'f'.repeat(400)}${String.fromCharCode(7)}.3mf`, size: bytes.length },
			await parseThreeMfBytes(bytes),
			view(id)
		);
		const r = add(id, up.uploadId, { name: 'Long', filamentMap: { '1': 'primary' } });
		const piece = view(id).customPieces[0];
		expect(piece.fileName!.length).toBeLessThanOrEqual(255);
		expect([...piece.fileName!].some((c) => c.charCodeAt(0) < 32)).toBe(false);
		for (const n of customPlates(id).map((p) => p.name)) {
			expect(n.length).toBeLessThanOrEqual('Long - '.length + 80);
			expect([...n].some((c) => c.charCodeAt(0) < 32 || c === '\u202e')).toBe(false);
		}
		// a stored name over the cap (made before the cap) still loads, and a rename shortens it
		const num = customPlates(id)[0].number;
		db.update(buildPlates)
			.set({ name: `Long - ${'y'.repeat(300)}` })
			.where(and(eq(buildPlates.buildId, id), eq(buildPlates.number, num)))
			.run();
		expect(customPlates(id)[0].name.length).toBeGreaterThan(300);
		renameCustomPiece(db, id, 'owner', r.pieceId, { name: 'Renamed' });
		expect(customPlates(id)[0].name).toBe(`Renamed - ${'y'.repeat(80)}`);
	});
});

describe('a failure after the commit', () => {
	it('keeps the committed thumbnails and clears the upload when only the publish fails', async () => {
		const id = mk();
		const up = await upload(id);
		const off = subscribeBuildEvents(id, () => {
			throw new Error('publish failed');
		});
		try {
			expect(() =>
				add(id, up.uploadId, { name: 'Beta', filamentMap: { '1': 'primary', '2': 'soft' } })
			).toThrow('publish failed');
		} finally {
			off();
		}
		const plates = customPlates(id);
		expect(plates).toHaveLength(2);
		for (const p of plates) expect(existsSync(join(uploadsDir(), p.thumbnailPath!))).toBe(true);
		expect(existsSync(uploadDir(up.uploadId))).toBe(false);
		expect(view(id).customPieces).toHaveLength(1);
	});

	it('removes the copied thumbnails when the transaction itself fails', async () => {
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
		expect(existsSync(join(uploadsDir(), `plates/${id}`))).toBe(false);
	});
});

describe('typing the time and grams when adding', () => {
	const ok = { name: 'Typed', filamentMap: { '1': 'primary', '2': 'soft' } };

	it('an unsliced file takes a typed time and grams; the grams count under the chosen color', async () => {
		const id = mk();
		const up = await upload(id, 'unsliced');
		const g0 = filamentStats(view(id)).find((f) => f.role === 'accent')!.total;
		const t0 = timeStats(view(id)).totalSec;
		add(id, up.uploadId, {
			name: 'Cup holder',
			role: 'accent',
			times: { '1': 5400 },
			grams: { '1': 42.5 },
			runs: { '1': 2 }
		});
		const [pl] = customPlates(id);
		expect(pl).toMatchObject({
			estSeconds: 5400,
			estSource: 'manual',
			slicerGrams: 42.5,
			gramsSource: 'user',
			runs: 2
		});
		const row = db.select().from(buildPlates).where(eq(buildPlates.number, pl.number)).get()!;
		expect(row).toMatchObject({
			estSeconds: null,
			manualEstSeconds: 5400,
			manualEstSource: 'user',
			slicerGrams: 42.5,
			slicerGramsSource: 'user'
		});
		expect(row.filamentGrams).toEqual({});
		const v = view(id);
		expect(timeStats(v).totalSec - t0).toBe(2 * 5400);
		expect(filamentStats(v).find((f) => f.role === 'accent')!.total - g0).toBeCloseTo(85, 1);
	});

	it('a sliced file keeps its own numbers unless a different one is typed', async () => {
		const id = mk();
		const up = await upload(id);
		add(id, up.uploadId, {
			...ok,
			// plate 1: same time as the file (stays the file's), grams changed; plate 2: time changed only
			times: { '1': 7200, '2': 4000 },
			grams: { '1': 140, '2': 12.5 }
		});
		const [a, b] = customPlates(id);
		const rows = db.select().from(buildPlates).orderBy(buildPlates.number).all();
		const ra = rows.find((r) => r.number === a.number)!;
		const rb = rows.find((r) => r.number === b.number)!;
		expect(ra).toMatchObject({ estSeconds: 7200, manualEstSeconds: null, manualEstSource: null });
		expect(ra).toMatchObject({ slicerGrams: 140, slicerGramsSource: 'user' });
		// 30 + 40 g in the file, doubled to 140 g: scaled per color
		expect(ra.filamentGrams).toEqual({ primary: 60, soft: 80 });
		expect(rb).toMatchObject({ estSeconds: 3600, manualEstSeconds: 4000, manualEstSource: 'user' });
		expect(rb).toMatchObject({ slicerGrams: 12.5, slicerGramsSource: 'file' });
		expect(rb.filamentGrams).toEqual({ primary: 12.5 });
		expect(b).toMatchObject({ estSeconds: 4000, estSource: 'manual' });
		expect(filamentStats(view(id)).find((f) => f.role === 'soft')!.total).toBeGreaterThanOrEqual(
			80
		);
	});

	it('refuses values out of range, wrong shapes and prototype keys', async () => {
		const id = mk();
		const up = await upload(id);
		const bad = (extra: Record<string, unknown>) =>
			status(() => add(id, up.uploadId, { ...ok, ...extra }));
		expect(bad({ times: { '1': 0 } })).toBe(400);
		expect(bad({ times: { '1': 2_592_001 } })).toBe(400);
		expect(bad({ times: { '1': 'soon' } })).toBe(400);
		expect(bad({ times: { '1': Number.NaN } })).toBe(400);
		expect(bad({ times: [5] })).toBe(400);
		expect(bad({ grams: { '1': 0 } })).toBe(400);
		expect(bad({ grams: { '1': -3 } })).toBe(400);
		expect(bad({ grams: { '1': 20001 } })).toBe(400);
		expect(bad({ grams: { '1': '5' } })).toBe(400);
		expect(bad({ grams: 'x' })).toBe(400);
		expect(bad({ times: JSON.parse('{"__proto__": 100}') })).toBe(400);
		expect(bad({ grams: JSON.parse('{"constructor": 5}') })).toBe(400);
		expect(customPlates(id)).toEqual([]);
		// a plate the file does not have is ignored, not applied to another
		add(id, up.uploadId, { ...ok, times: { '9': 100 } });
		expect(customPlates(id).map((p) => p.estSeconds)).toEqual([7200, 3600]);
	});
});

describe('renaming a custom piece', () => {
	it('renames the piece, its parts and its plates, and records the change', async () => {
		const id = mk();
		const up = await upload(id);
		const r = add(id, up.uploadId, {
			name: 'Beta handle',
			filamentMap: { '1': 'primary', '2': 'soft' }
		});
		expect(renameCustomPiece(db, id, 'owner', r.pieceId, { name: '  Push   handle ' })).toEqual({
			name: 'Push handle'
		});
		const v = view(id);
		expect(v.customPieces[0].name).toBe('Push handle');
		expect(customPlates(id).map((p) => p.name)).toEqual([
			'Push handle - HANDLE BAR',
			'Push handle - HANDLE GRIP'
		]);
		expect(v.customPieces[0].parts.map((s) => v.parts.find((p) => p.slug === s)!.name)).toEqual([
			'Push handle - HANDLE BAR',
			'Push handle - HANDLE GRIP'
		]);
		const row = db.select().from(buildCustomPieces).get()!;
		expect(row.parts.map((p) => p.name)).toEqual([
			'Push handle - HANDLE BAR',
			'Push handle - HANDLE GRIP'
		]);
		const act = db.select().from(activity).where(eq(activity.kind, 'custom.rename')).all();
		expect(act).toHaveLength(1);
		expect(act[0].payload).toEqual({
			pieceId: r.pieceId,
			name: 'Push handle',
			from: 'Beta handle'
		});
		expect(
			describeActivity(
				{
					id: 'x',
					userId: 'owner',
					userName: 'Owen',
					kind: 'custom.rename',
					payload: act[0].payload,
					at: ''
				},
				v
			)
		).toBe('Owen renamed the custom part "Beta handle" to "Push handle"');
		// the same name again changes and records nothing
		renameCustomPiece(db, id, 'owner', r.pieceId, { name: 'Push handle' });
		expect(db.select().from(activity).where(eq(activity.kind, 'custom.rename')).all()).toHaveLength(
			1
		);
	});

	it('a single-plate piece takes the new name on its plate and part', async () => {
		const id = mk();
		const up = await upload(id, 'unsliced');
		const r = add(id, up.uploadId, { name: 'Cup', role: 'accent' });
		renameCustomPiece(db, id, 'owner', r.pieceId, { name: 'Cup holder v2' });
		const v = view(id);
		expect(customPlates(id)[0].name).toBe('Cup holder v2');
		expect(v.parts.find((p) => p.slug === customPlates(id)[0].parts[0])!.name).toBe(
			'Cup holder v2'
		);
	});

	it('does not touch the rearranging: custom.rename is not a re-arrange kind', async () => {
		const { REARRANGE_KINDS } = await import('./arrange-plan');
		expect(REARRANGE_KINDS.has('custom.rename')).toBe(false);
	});

	it('refuses viewers, foreign pieces and bad names', async () => {
		const id = mk();
		const up = await upload(id);
		const r = add(id, up.uploadId, { name: 'Beta', filamentMap: { '1': 'primary', '2': 'soft' } });
		const other = mk();
		expect(status(() => renameCustomPiece(db, id, 'viewer', r.pieceId, { name: 'x' }))).toBe(403);
		expect(status(() => renameCustomPiece(db, id, 'outsider', r.pieceId, { name: 'x' }))).toBe(404);
		expect(status(() => renameCustomPiece(db, id, 'owner', 'nope', { name: 'x' }))).toBe(404);
		expect(status(() => renameCustomPiece(db, other, 'owner', r.pieceId, { name: 'x' }))).toBe(404);
		expect(status(() => renameCustomPiece(db, id, 'owner', r.pieceId, { name: '   ' }))).toBe(400);
		expect(status(() => renameCustomPiece(db, id, 'owner', r.pieceId, { name: 5 }))).toBe(400);
		expect(status(() => renameCustomPiece(db, id, 'owner', r.pieceId, null))).toBe(400);
		expect(status(() => renameCustomPiece(db, id, 'owner', r.pieceId, {}))).toBe(400);
		// a draft takes the call, but the piece must be the draft's own
		const draft = mk({ kind: 'draft' });
		expect(status(() => renameCustomPiece(db, draft, 'owner', r.pieceId, { name: 'x' }))).toBe(404);
		expect(view(id).customPieces[0].name).toBe('Beta');
	});
});

describe('a filament set to "Not used in this build"', () => {
	// plate 1: slot 1 (30 g) + slot 2 (40 g), 70 g; plate 2: slot 1 only, 12.5 g
	const base = { filamentMap: { '1': 'primary' } };

	it('drops the ignored slot from the plate grams, the total and the role', async () => {
		const id = mk();
		const g0 = filamentStats(view(id)).reduce((a, f) => a + f.total, 0);
		const up = await upload(id);
		add(id, up.uploadId, {
			name: 'Beta',
			plates: [1],
			...base,
			ignore: ['2']
		});
		const [pl] = customPlates(id);
		expect(pl).toMatchObject({ slicerGrams: 30, gramsSource: 'file', estSeconds: 7200 });
		expect(pl.filamentGrams).toEqual({ primary: 30 });
		const v = view(id);
		expect(v.parts.find((p) => p.slug === v.customPieces[0].parts[0])!.role).toBe('primary');
		expect(v.customPieces[0].colors[0].roles).toEqual([{ role: 'primary', grams: 30 }]);
		// the build's filament totals count only the kept grams
		expect(filamentStats(v).reduce((x, f) => x + f.total, 0) - g0).toBeCloseTo(30, 1);
	});

	it('a typed total is spread over the kept slots only', async () => {
		const id = mk();
		const up = await upload(id);
		add(id, up.uploadId, {
			name: 'Beta',
			plates: [1],
			filamentMap: { '1': 'primary', '2': 'soft' },
			ignore: ['1'],
			grams: { '1': 25 }
		});
		const [pl] = customPlates(id);
		expect(pl).toMatchObject({ slicerGrams: 25, gramsSource: 'user' });
		expect(pl.filamentGrams).toEqual({ soft: 25 });
	});

	it('refuses a plate with every weighed slot ignored; unweighed plates are fine', async () => {
		const id = mk();
		const up = await upload(id);
		expect(
			status(() => add(id, up.uploadId, { name: 'Beta', plates: [1], ignore: ['1', '2'] }))
		).toBe(400);
		// plate 2 only has slot 1: ignoring slot 2 changes nothing there
		const r = add(id, up.uploadId, { name: 'Beta', plates: [2], ...base, ignore: ['2'] });
		expect(r.plates).toHaveLength(1);
		expect(customPlates(id)[0]).toMatchObject({ slicerGrams: 12.5 });
		// an unsliced file has no grams: ignore is harmless
		const un = await upload(id, 'unsliced');
		expect(
			status(() => add(id, un.uploadId, { name: 'Cup', role: 'primary', ignore: ['1'] }))
		).toBe(0);
	});

	it('refuses wrong shapes and a saved copy keeps only the kept grams', async () => {
		const id = mk();
		const up = await upload(id);
		for (const bad of [
			'1',
			[1],
			['__proto__x'.repeat(3)],
			Array.from({ length: 33 }, (_, i) => `${i}`)
		])
			expect(status(() => add(id, up.uploadId, { name: 'B', ...base, ignore: bad }))).toBe(400);
		add(id, up.uploadId, { name: 'Beta', plates: [1], ...base, ignore: ['2'] });
		const { saveToLibrary } = await import('../custom-library');
		const piece = view(id).customPieces[0];
		const saved = saveToLibrary(db, 'owner', id, piece.id);
		expect(saved.plates[0]).toMatchObject({ grams: 30, filamentGrams: { primary: 30 } });
	});
});

describe('changing the color of a custom part', () => {
	const piece = async (id: string, body: Record<string, unknown> = {}) => {
		const up = await upload(id);
		const r = add(id, up.uploadId, {
			name: 'Beta',
			filamentMap: { '1': 'primary', '2': 'soft' },
			...body
		});
		const p = view(id).customPieces.find((c) => c.id === r.pieceId)!;
		return p;
	};
	const recolor = (id: string, pieceId: string, roles: unknown, user = 'owner') =>
		recolorCustomPiece(db, id, user, pieceId, { roles });
	const recolorActs = () =>
		db.select().from(activity).where(eq(activity.kind, 'custom.recolor')).all();

	it('a single-color part moves its role and its grams', async () => {
		const id = mk();
		const p = await piece(id);
		const [s2] = [p.parts[1]]; // plate 2: primary only
		const r = recolor(id, p.id, { [s2]: { primary: 'accent' } });
		expect(r.changes).toEqual([{ part: 'Beta - HANDLE GRIP', from: 'primary', to: 'accent' }]);
		const v = view(id);
		expect(v.parts.find((x) => x.slug === s2)!.role).toBe('accent');
		expect(customPlates(id)[1].filamentGrams).toEqual({ accent: 12.5 });
		expect(v.customPieces[0].colors[1].roles).toEqual([{ role: 'accent', grams: 12.5 }]);
		expect(recolorActs()).toHaveLength(1);
		expect(
			describeActivity(
				{
					id: 'x',
					userId: 'owner',
					userName: 'Owen',
					kind: 'custom.recolor',
					payload: recolorActs()[0].payload,
					at: ''
				},
				v
			)
		).toMatch(/^Owen changed the color of "Beta - HANDLE GRIP" from .* to /);
	});

	it('a multi-color part: one role at a time, and two roles can merge', async () => {
		const id = mk();
		const p = await piece(id);
		const s1 = p.parts[0];
		recolor(id, p.id, { [s1]: { soft: 'accent' } });
		expect(customPlates(id)[0].filamentGrams).toEqual({ primary: 30, accent: 40 });
		expect(view(id).parts.find((x) => x.slug === s1)!.role).toBe('accent');
		recolor(id, p.id, { [s1]: { primary: 'accent' } });
		expect(customPlates(id)[0].filamentGrams).toEqual({ accent: 70 });
		expect(view(id).parts.find((x) => x.slug === s1)!.role).toBe('accent');
		expect(recolorActs()).toHaveLength(2);
	});

	it('an unsliced part has no grams to move: its role changes', async () => {
		const id = mk();
		const up = await upload(id, 'unsliced');
		const r = add(id, up.uploadId, { name: 'Cup', role: 'primary' });
		const p = view(id).customPieces.find((c) => c.id === r.pieceId)!;
		expect(p.colors[0].roles).toEqual([{ role: 'primary', grams: null }]);
		recolor(id, p.id, { [p.parts[0]]: { primary: 'tire' } });
		expect(view(id).parts.find((x) => x.slug === p.parts[0])!.role).toBe('tire');
	});

	it('no change leaves no activity row; bad input is refused; viewers and foreigners too', async () => {
		const id = mk();
		const p = await piece(id);
		const s = p.parts[0];
		const before = recolorActs().length;
		recolor(id, p.id, { [s]: { primary: 'primary' } });
		expect(recolorActs()).toHaveLength(before);
		for (const bad of [
			{ [s]: { primary: 'nope' } }, // not a color of the build
			{ [s]: { tire: 'accent' } }, // the part has no tire color
			{ nothere: { primary: 'accent' } }, // not a part of this piece
			{ [s]: {} },
			{ [s]: 'accent' },
			{},
			'x'
		])
			expect(status(() => recolor(id, p.id, bad))).toBe(400);
		expect(status(() => recolor(id, 'nope', { [s]: { primary: 'accent' } }))).toBe(404);
		expect(status(() => recolor(id, p.id, { [s]: { primary: 'accent' } }, 'viewer'))).toBe(403);
		expect(status(() => recolor(id, p.id, { [s]: { primary: 'accent' } }, 'outsider'))).toBe(404);
		expect(customPlates(id)[0].filamentGrams).toEqual({ primary: 30, soft: 40 });
	});

	it('is allowed in a draft, is not a re-arrange kind and leaves a saved part alone', async () => {
		const { REARRANGE_KINDS } = await import('./arrange-plan');
		expect(REARRANGE_KINDS.has('custom.recolor')).toBe(false);
		const d = mk({ kind: 'draft' });
		const p = await piece(d);
		recolor(d, p.id, { [p.parts[1]]: { primary: 'accent' } });
		expect(view(d).parts.find((x) => x.slug === p.parts[1])!.role).toBe('accent');
		const id = mk();
		const q = await piece(id);
		const { saveToLibrary } = await import('../custom-library');
		const saved = saveToLibrary(db, 'owner', id, q.id);
		recolor(id, q.id, { [q.parts[1]]: { primary: 'accent' } });
		const { listLibrary } = await import('../custom-library');
		expect(listLibrary(db, orgId, 'owner').find((l) => l.id === saved.id)!.plates[1].role).toBe(
			'primary'
		);
		expect(view(id).customPieces[0].libraryId).toBe(saved.id);
	});
});

describe('custom parts in a draft', () => {
	it('add, rename, remove and a saved part all work on a draft', async () => {
		const d = mk({ kind: 'draft' });
		const up = await upload(d);
		const r = add(d, up.uploadId, { name: 'Beta', filamentMap: { '1': 'primary', '2': 'soft' } });
		renameCustomPiece(db, d, 'owner', r.pieceId, { name: 'Beta 2' });
		expect(view(d).customPieces[0]).toMatchObject({ name: 'Beta 2', removable: true });
		removeCustomPiece(db, d, 'owner', r.pieceId);
		expect(view(d).customPieces).toHaveLength(0);
	});
});

describe('the plate upload with a filament left on Not tracked', () => {
	it('the plate weight leaves out the untracked grams, like its per-color split', async () => {
		const bytes = makeProjectThreeMf({
			sliced: true,
			filamentTypes: ['PETG', 'TPU'],
			plates: [
				{
					name: 'BAR',
					prediction: 600,
					weight: 70,
					filaments: { 1: 30, 2: 40 },
					objects: [{ name: 'Left handle' }]
				}
			]
		});
		const mapOnce = async (filamentMap: Record<string, string>) => {
			const b = mk();
			const up = createUpload(
				db,
				b,
				'owner',
				{ name: 'k.3mf', size: bytes.length },
				await parseThreeMfBytes(bytes),
				view(b)
			);
			const key = `1:${up.summary.plates[0].objects[0].id}`;
			applyUpload(db, b, 'owner', up.uploadId, { mapping: { [key]: 'handle-left' }, filamentMap });
			return kitPlates(b)[0];
		};
		// slot 2 left out: 40 g of PLA supports are not this build's
		const kept = await mapOnce({ '1': 'primary' });
		expect(kept.filamentGrams).toEqual({ primary: 30 });
		expect(kept.slicerGrams).toBe(30);
		// both mapped: the file's total
		const both = await mapOnce({ '1': 'primary', '2': 'soft' });
		expect(both.slicerGrams).toBe(70);
		// nothing mapped: the file's total stands (nothing to keep)
		const none = await mapOnce({});
		expect(none.slicerGrams).toBe(70);
	});
});

/** Role keys named like `Object.prototype` members are valid filament keys: sums must stay numbers. */
describe('filament keys that are Object.prototype names', () => {
	/** A build whose accent and tire filaments are keyed `constructor` and `toString`. */
	const mkOdd = () => {
		const id = mk();
		for (const [from, to] of [
			['accent', 'constructor'],
			['tire', 'toString']
		])
			db.update(buildFilaments)
				.set({ roleKey: to })
				.where(and(eq(buildFilaments.buildId, id), eq(buildFilaments.roleKey, from)))
				.run();
		return id;
	};
	const addOdd = async (id: string, map: Record<string, string>) => {
		const up = await upload(id);
		const r = add(id, up.uploadId, { name: 'Odd', filamentMap: map });
		return view(id).customPieces.find((c) => c.id === r.pieceId)!;
	};

	it('adding sums grams per role and picks the heaviest role', async () => {
		const id = mkOdd();
		const p = await addOdd(id, { '1': 'constructor', '2': 'toString' });
		expect(customPlates(id)[0].filamentGrams).toEqual({ constructor: 30, toString: 40 });
		expect(customPlates(id)[1].filamentGrams).toEqual({ constructor: 12.5 });
		expect(view(id).parts.find((x) => x.slug === p.parts[0])!.role).toBe('toString');
		const id2 = mkOdd();
		await addOdd(id2, { '1': 'constructor', '2': 'constructor' });
		expect(customPlates(id2)[0].filamentGrams).toEqual({ constructor: 70 });
		// a typed total scales them
		const id3 = mkOdd();
		const up = await upload(id3);
		add(id3, up.uploadId, {
			name: 'Odd',
			filamentMap: { '1': 'constructor', '2': 'toString' },
			grams: { '1': 35 }
		});
		const g = customPlates(id3)[0].filamentGrams;
		expect(Object.values(g).every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(true);
		expect(g).toEqual({ constructor: 15, toString: 20 });
	});

	it('recoloring to and from such a key keeps numbers', async () => {
		const id = mkOdd();
		const p = await addOdd(id, { '1': 'primary', '2': 'soft' });
		const [s1, s2] = p.parts;
		recolorCustomPiece(db, id, 'owner', p.id, { roles: { [s2]: { primary: 'constructor' } } });
		expect(customPlates(id)[1].filamentGrams).toEqual({ constructor: 12.5 });
		recolorCustomPiece(db, id, 'owner', p.id, {
			roles: { [s1]: { primary: 'constructor', soft: 'constructor' } }
		});
		expect(customPlates(id)[0].filamentGrams).toEqual({ constructor: 70 });
		recolorCustomPiece(db, id, 'owner', p.id, { roles: { [s1]: { constructor: 'toString' } } });
		expect(customPlates(id)[0].filamentGrams).toEqual({ toString: 70 });
		expect(view(id).parts.find((x) => x.slug === s1)!.role).toBe('toString');
		recolorCustomPiece(db, id, 'owner', p.id, { roles: { [s2]: { constructor: 'primary' } } });
		expect(customPlates(id)[1].filamentGrams).toEqual({ primary: 12.5 });
	});

	it('saving, applying and editing a saved part with such keys', async () => {
		const lib = await import('../custom-library');
		const id = mkOdd();
		const p = await addOdd(id, { '1': 'constructor', '2': 'toString' });
		const saved = lib.saveToLibrary(db, 'owner', id, p.id);
		// another odd build: the saved colors map onto the same keys
		const id2 = mkOdd();
		lib.applyLibraryPiece(db, id2, 'owner', saved.id);
		expect(customPlates(id2)[0].filamentGrams).toEqual({ constructor: 30, toString: 40 });
		// a plain build: unknown roles fold onto its first filament and sum
		const id3 = mk();
		lib.applyLibraryPiece(db, id3, 'owner', saved.id);
		const fg = customPlates(id3)[0].filamentGrams;
		expect(Object.values(fg)).toEqual([70]);
		// edit (the saved part's roles must be the kit's): odd keys re-key and merge
		const out = lib.updateLibraryPiece(db, 'owner', orgId, saved.id, {
			plates: [{ index: 0, roles: { toString: 'accent' } }]
		});
		expect(out.plates[0].filamentGrams).toEqual({ constructor: 30, accent: 40 });
		const out2 = lib.updateLibraryPiece(db, 'owner', orgId, saved.id, {
			plates: [{ index: 0, roles: { constructor: 'accent' } }]
		});
		expect(out2.plates[0].filamentGrams).toEqual({ accent: 70 });
		const out3 = lib.updateLibraryPiece(db, 'owner', orgId, saved.id, {
			plates: [{ index: 1, grams: 5 }]
		});
		expect(out3.plates[1].filamentGrams).toEqual({ constructor: 5 });
	});

	it('rekeyRoles itself', () => {
		const r = rekeyRoles({ a: 1, toString: 2 }, 'a', new Map([['a', 'toString']]));
		expect(r.filamentGrams).toEqual({ toString: 3 });
		expect(r.role).toBe('toString');
		expect(rekeyRoles({}, 'valueOf', new Map([['valueOf', 'constructor']])).role).toBe(
			'constructor'
		);
	});
});

describe('rekeyRoles keeps the part role consistent', () => {
	it('a stored role that is not a gram key is renamed by the map', () => {
		// grams on soft only, role says primary (stale): primary -> accent renames the role; soft stays heaviest
		const r = rekeyRoles({ soft: 5 }, 'primary', new Map([['primary', 'accent']]));
		expect(r).toEqual({ filamentGrams: { soft: 5 }, role: 'soft' });
		// a tie keeps the renamed current role when it is among the heaviest
		const t = rekeyRoles({ soft: 5, tire: 5 }, 'tire', new Map([['soft', 'accent']]));
		expect(t.role).toBe('tire');
		const t2 = rekeyRoles({ soft: 5, tire: 5 }, 'soft', new Map([['soft', 'accent']]));
		expect(t2.role).toBe('accent');
		// no grams: the mapped role
		expect(rekeyRoles({}, 'primary', new Map([['primary', 'accent']])).role).toBe('accent');
		expect(rekeyRoles({}, 'primary', new Map()).role).toBe('primary');
	});

	it('after a recolor the part role is the heaviest of the re-keyed grams', async () => {
		const id = mk();
		const up = await upload(id);
		const r = add(id, up.uploadId, { name: 'B', filamentMap: { '1': 'primary', '2': 'soft' } });
		const p = view(id).customPieces.find((c) => c.id === r.pieceId)!;
		// plate 1: primary 30, soft 40 (role soft); move soft to tire: role follows the heaviest
		recolorCustomPiece(db, id, 'owner', p.id, { roles: { [p.parts[0]]: { soft: 'tire' } } });
		expect(view(id).parts.find((x) => x.slug === p.parts[0])!.role).toBe('tire');
		// stale stored role (not a gram key): the recolor still leaves role = heaviest gram role
		const row = db.select().from(buildCustomPieces).where(eq(buildCustomPieces.id, p.id)).get()!;
		db.update(buildCustomPieces)
			.set({ parts: row.parts.map((x, i) => (i === 0 ? { ...x, role: 'accent' } : x)) })
			.where(eq(buildCustomPieces.id, p.id))
			.run();
		recolorCustomPiece(db, id, 'owner', p.id, { roles: { [p.parts[0]]: { accent: 'soft' } } });
		expect(view(id).parts.find((x) => x.slug === p.parts[0])!.role).toBe('tire');
	});
});

describe('replaces with kit parts a color option made inactive', () => {
	it('inactive and already skipped slugs are dropped; unknown stays 400; printing stays 409', async () => {
		const id = mk();
		const v = view(id);
		const active = new Set(v.parts.map((x) => x.slug));
		const inactive = v.allParts.find((x) => !x.custom && !active.has(x.slug))!;
		expect(inactive).toBeTruthy();
		const kit = v.parts.filter((x) => !x.custom);
		const [a, b] = kit;
		skipParts(db, id, 'owner', { slugs: [b.slug], skip: true });
		const up = await upload(id);
		const r = add(id, up.uploadId, {
			name: 'Beta',
			filamentMap: { '1': 'primary', '2': 'soft' },
			replaces: [a.slug, inactive.slug, b.slug]
		});
		expect(r.skipped).toEqual([a.slug]);
		// unknown slugs are still refused
		const up2 = await upload(id);
		expect(
			status(() =>
				add(id, up2.uploadId, {
					name: 'X',
					filamentMap: { '1': 'primary', '2': 'soft' },
					replaces: ['nope']
				})
			)
		).toBe(400);
		// a printing part is still a 409
		const c = kit.find((x) => x.slug !== a.slug && x.slug !== b.slug)!;
		setPartStatus(db, id, 'owner', c.slug, { status: 'Printing' });
		expect(
			status(() =>
				add(id, up2.uploadId, {
					name: 'X',
					filamentMap: { '1': 'primary', '2': 'soft' },
					replaces: [c.slug]
				})
			)
		).toBe(409);
	});
});

describe('PATCH of a custom piece', () => {
	it('name and roles together are refused; each alone works', async () => {
		const id = mk();
		const up = await upload(id);
		const r = add(id, up.uploadId, { name: 'Beta', filamentMap: { '1': 'primary', '2': 'soft' } });
		const p = view(id).customPieces.find((c) => c.id === r.pieceId)!;
		const roles = { [p.parts[1]]: { primary: 'accent' } };
		expect(status(() => patchCustomPiece(db, id, 'owner', p.id, { name: 'New', roles }))).toBe(400);
		expect(view(id).customPieces[0].name).toBe('Beta');
		expect(customPlates(id)[1].filamentGrams).toEqual({ primary: 12.5 });
		expect(patchCustomPiece(db, id, 'owner', p.id, { name: 'New' })).toEqual({ name: 'New' });
		expect(patchCustomPiece(db, id, 'owner', p.id, { roles })).toHaveProperty('changes');
	});
});
