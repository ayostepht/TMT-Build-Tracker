import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { filamentStats, timeStats } from '#lib/domain/accounting.ts';
import { isCustomPlate } from '#lib/domain/custom.ts';
import { ApiError } from '../access';
import { uploadsDir } from '../config';
import { applyLibraryPiece, saveToLibrary } from '../custom-library';
import { openDb, runMigrations, type Db } from '../db';
import { buildCustomPieces, builds, member, organization, templates, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { makeProjectThreeMf } from '../threemf/fixtures';
import { parseThreeMfBytes } from '../threemf';
import { addRun, deleteBuild, moveBuild, promoteDraft, setPartStatus, skipParts } from './actions';
import { createBuild } from './create';
import { addCustomPiece, removeCustomPiece, renameCustomPiece } from './custom-pieces';
import { removeBuildPlateFiles } from './custom-plates';
import { createUpload } from './plates';
import { loadBuildView } from './view';

let db: Db;
let templateId: string;
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-dcust-')), 'unused.db');

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: 'org1', name: 'Chapter', slug: 'chapter', createdAt: new Date() })
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
				.values({ id: `m-${u}`, organizationId: 'org1', userId: u, role, createdAt: new Date() })
				.run();
	}
});

const mk = (kind?: 'draft', extra: { setup?: boolean } = {}) =>
	createBuild(
		db,
		{ organizationId: 'org1', templateId, designId: null, name: 'B', kind, ...extra },
		'owner'
	);
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const status = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		if (e instanceof ApiError) return e.status;
		throw e;
	}
	return 0;
};
const grams = (id: string) => filamentStats(view(id)).reduce((a, f) => a + f.total, 0);
const map = { '1': 'primary', '2': 'soft' };

async function upload(id: string) {
	const bytes = makeProjectThreeMf({
		sliced: true,
		filamentTypes: ['PETG', 'TPU'],
		plates: [
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
	});
	const parsed = await parseThreeMfBytes(bytes);
	return createUpload(db, id, 'owner', { name: 'beta.3mf', size: bytes.length }, parsed, view(id));
}
const addPiece = async (id: string, body: Record<string, unknown> = {}) =>
	addCustomPiece(db, id, 'owner', (await upload(id)).uploadId, {
		name: 'Beta',
		filamentMap: map,
		...body
	});

describe('Studio draft: Not printing', () => {
	it('leaves skipped parts out of the estimate and brings them back', () => {
		const id = mk('draft');
		const v = view(id);
		const g0 = grams(id);
		const s0 = timeStats(v).totalSec;
		skipParts(db, id, 'owner', { slugs: ['handle-left'], skip: true });
		expect(view(id).skipped.map((s) => s.slug)).toEqual(['handle-left']);
		expect(grams(id)).toBeLessThan(g0);
		expect(timeStats(view(id)).totalSec).toBeLessThan(s0);
		skipParts(db, id, 'owner', { slugs: ['handle-left'], skip: false });
		expect(view(id).skipped).toEqual([]);
		expect(grams(id)).toBeCloseTo(g0, 5);
		expect(status(() => skipParts(db, id, 'viewer', { slugs: ['handle-left'], skip: true }))).toBe(
			403
		);
		expect(
			status(() => skipParts(db, id, 'outsider', { slugs: ['handle-left'], skip: true }))
		).toBe(404);
	});
});

describe('Studio draft: custom parts', () => {
	it('adds, renames and removes a piece; it enters the estimate and is To print', async () => {
		const id = mk('draft');
		const r = await addPiece(id, { replaces: ['handle-left'] });
		const v = view(id);
		expect(v.customPieces).toHaveLength(1);
		expect(v.skipped.map((s) => s.slug)).toEqual(['handle-left']);
		expect(v.plates.filter(isCustomPlate)).toHaveLength(2);
		for (const slug of v.customPieces[0].parts) expect(v.state[slug].status).toBe('To print');
		// the custom plates' grams count
		const withPiece = grams(id);
		const timeWith = timeStats(view(id)).totalSec;
		skipParts(db, id, 'owner', { slugs: v.customPieces[0].parts, skip: true });
		expect(grams(id)).toBeLessThan(withPiece);
		expect(timeStats(view(id)).totalSec).toBeLessThan(timeWith);
		skipParts(db, id, 'owner', { slugs: v.customPieces[0].parts, skip: false });

		renameCustomPiece(db, id, 'owner', r.pieceId, { name: 'Gamma' });
		expect(view(id).customPieces[0].name).toBe('Gamma');
		expect(status(() => renameCustomPiece(db, id, 'viewer', r.pieceId, { name: 'x' }))).toBe(403);

		removeCustomPiece(db, id, 'owner', r.pieceId, { restore: true });
		const after = view(id);
		expect(after.customPieces).toEqual([]);
		expect(after.skipped).toEqual([]);
		expect(after.plates.filter(isCustomPlate)).toEqual([]);
	});

	it('refuses a viewer and a non-member, and the caps still apply', async () => {
		const id = mk('draft');
		const up = await upload(id);
		const body = { name: 'Beta', filamentMap: map };
		expect(status(() => addCustomPiece(db, id, 'viewer', up.uploadId, body))).toBe(403);
		expect(status(() => addCustomPiece(db, id, 'outsider', up.uploadId, body))).toBe(404);
		expect(view(id).customPieces).toEqual([]);
	});

	it('still refuses a run, a status and printing on a custom part of a draft', async () => {
		const id = mk('draft');
		await addPiece(id);
		const slug = view(id).customPieces[0].parts[0];
		expect(
			status(() =>
				addRun(db, id, 'owner', { date: '2026-03-01', result: 'Success', partSlug: slug, grams: 5 })
			)
		).toBe(400);
		expect(status(() => setPartStatus(db, id, 'owner', slug, { status: 'Printed' }))).toBe(400);
		expect(view(id).runs).toEqual([]);
	});

	it('deleting a draft removes its custom thumbnails', async () => {
		const id = mk('draft');
		await addPiece(id);
		const dir = join(uploadsDir(), 'plates', id);
		expect(existsSync(dir)).toBe(true);
		deleteBuild(db, id, 'owner');
		removeBuildPlateFiles(id);
		expect(existsSync(dir)).toBe(false);
	});
});

describe('Studio draft: saved parts', () => {
	it('saves a piece from a draft and applies it to another draft and to a build', async () => {
		const d1 = mk('draft');
		const p = await addPiece(d1, { replaces: ['handle-left'] });
		const saved = saveToLibrary(db, 'owner', d1, p.pieceId);
		expect(view(d1).customPieces[0].libraryId).toBe(saved.id);
		expect(status(() => saveToLibrary(db, 'viewer', d1, p.pieceId))).toBe(403);

		const d2 = mk('draft');
		const r = applyLibraryPiece(db, d2, 'owner', saved.id)!;
		expect(r.plates).toHaveLength(2);
		expect(view(d2).skipped.map((s) => s.slug)).toEqual(['handle-left']);
		expect(view(d2).customPieces[0].libraryId).toBe(saved.id);
		expect(applyLibraryPiece(db, d2, 'owner', saved.id)).toBeNull();
		expect(status(() => applyLibraryPiece(db, d2, 'viewer', saved.id))).toBe(403);

		const b = mk();
		expect(applyLibraryPiece(db, b, 'owner', saved.id)).not.toBeNull();
	});

	it('does not apply default saved parts to a draft made through the setup flow', async () => {
		const b = mk();
		const p = await addPiece(b);
		saveToLibrary(db, 'owner', b, p.pieceId, { isDefault: true });
		const draft = mk('draft', { setup: true });
		expect(view(draft).customPieces).toEqual([]);
		const wizard = mk(undefined, { setup: true });
		expect(view(wizard).customPieces).toHaveLength(1);
	});
});

describe('Studio draft: promotion', () => {
	it('keeps skipped parts, pieces, plates, thumbnails and library links; the custom plate can be logged', async () => {
		const id = mk('draft');
		const p = await addPiece(id, { replaces: ['handle-left'] });
		const saved = saveToLibrary(db, 'owner', id, p.pieceId);
		skipParts(db, id, 'owner', { slugs: ['handle-right'], skip: true });
		const before = view(id);
		const dir = join(uploadsDir(), 'plates', id);
		expect(existsSync(dir)).toBe(true);

		promoteDraft(db, id, 'owner');
		const after = view(id);
		expect(after.build.kind).toBe('build');
		expect(after.skipped.map((s) => s.slug).sort()).toEqual(['handle-left', 'handle-right']);
		expect(after.customPieces).toHaveLength(1);
		expect(after.customPieces[0].libraryId).toBe(saved.id);
		expect(after.plates.map((x) => x.number)).toEqual(before.plates.map((x) => x.number));
		expect(after.plates.filter(isCustomPlate)).toHaveLength(2);
		expect(existsSync(dir)).toBe(true);
		expect(grams(id)).toBeCloseTo(
			filamentStats(before).reduce((a, f) => a + f.total, 0),
			5
		);

		const plate = after.plates.filter(isCustomPlate)[0];
		addRun(db, id, 'owner', {
			date: '2026-03-01',
			result: 'Success',
			plateNumber: plate.number,
			grams: 10
		});
		expect(view(id).runs).toHaveLength(1);
	});

	it('clears library links when a draft moves to another workspace', async () => {
		const id = mk('draft');
		const p = await addPiece(id);
		saveToLibrary(db, 'owner', id, p.pieceId);
		db.update(organization)
			.set({ metadata: JSON.stringify({ personal: true }) })
			.where(eq(organization.id, 'org1'))
			.run();
		db.insert(organization)
			.values({ id: 'org2', name: 'Chapter 2', slug: 'c2', createdAt: new Date() })
			.run();
		db.insert(member)
			.values({
				id: 'm-o2',
				organizationId: 'org2',
				userId: 'owner',
				role: 'owner',
				createdAt: new Date()
			})
			.run();
		moveBuild(db, id, 'owner', { organizationId: 'org2' });
		expect(db.select().from(builds).where(eq(builds.id, id)).get()!.organizationId).toBe('org2');
		expect(view(id).customPieces).toHaveLength(1);
		expect(
			db.select().from(buildCustomPieces).where(eq(buildCustomPieces.buildId, id)).get()!.libraryId
		).toBeNull();
	});
});
