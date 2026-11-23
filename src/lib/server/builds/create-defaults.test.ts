import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { isCustomPlate } from '#lib/domain/custom.ts';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildCustomPieces,
	buildParts,
	buildPlates,
	member,
	organization,
	templates,
	user,
	workspaceCustomPieces,
	type LibraryPlate
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';

// A saved part named "Late failure" is applied for real and then fails: proves the per-piece savepoint.
vi.mock('../custom-library', async (orig) => {
	const real = await orig<typeof import('../custom-library')>();
	return {
		...real,
		applyLibraryPieceTx: ((...args: Parameters<typeof real.applyLibraryPieceTx>) => {
			const r = real.applyLibraryPieceTx(...args);
			if (args[2].name === 'Late failure') throw new ApiError(400, 'late failure');
			return r;
		}) as typeof real.applyLibraryPieceTx
	};
});

const { createBuild } = await import('./create');
const { loadBuildView } = await import('./view');

let db: Db;
let templateId: string;
let kitSlug: string;
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-cdef-')), 'unused.db');

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	kitSlug = 'handle-left';
	for (const o of ['org1', 'org2'])
		db.insert(organization)
			.values({ id: o, name: `Chapter ${o}`, slug: o, createdAt: new Date() })
			.run();
	for (const [u, o] of [
		['owner', 'org1'],
		['other', 'org2']
	]) {
		db.insert(user)
			.values({ id: u, name: `User ${u}`, email: `${u}@example.test`, createdAt: new Date() })
			.run();
		db.insert(member)
			.values({ id: `m-${u}`, organizationId: o, userId: u, role: 'owner', createdAt: new Date() })
			.run();
	}
});

const plate = (name: string): LibraryPlate => ({
	name,
	estSeconds: 3600,
	grams: 20,
	filamentGrams: { primary: 20 },
	role: 'primary',
	runs: 1,
	thumb: false
});
const save = (
	org: string,
	name: string,
	opts: { isDefault?: boolean; plates?: LibraryPlate[]; replaces?: string[] } = {}
) =>
	db
		.insert(workspaceCustomPieces)
		.values({
			organizationId: org,
			name,
			sliced: true,
			templateId,
			replaces: opts.replaces ?? [],
			plates: opts.plates ?? [plate('Main')],
			isDefault: opts.isDefault ?? true,
			createdBy: 'owner'
		})
		.returning()
		.get();
const mk = (extra: Record<string, unknown> = {}, org = 'org1', by = 'owner') =>
	createBuild(
		db,
		{ organizationId: org, templateId, designId: null, name: 'B', setup: true, ...extra },
		by
	);
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const kinds = (id: string) =>
	db
		.select({ kind: activity.kind })
		.from(activity)
		.where(eq(activity.buildId, id))
		.all()
		.map((a) => a.kind);

describe('createBuild: saved custom parts marked "Include in new builds"', () => {
	it('adds them to a setup build with plates, replaced kit parts and activity rows', () => {
		save('org1', 'Beta handle', { replaces: [kitSlug] });
		const id = mk();
		const v = view(id);
		expect(v.customPieces.map((c) => c.name)).toEqual(['Beta handle']);
		expect(v.customPieces[0].libraryId).toBeTruthy();
		expect(v.plates.filter(isCustomPlate)).toHaveLength(1);
		expect(v.skipped.map((s) => s.slug)).toContain(kitSlug);
		const k = kinds(id);
		expect(k.filter((x) => x === 'custom.add')).toHaveLength(1);
		expect(k).toContain('build.create');
	});

	it('does not add them to drafts or builds made without the setup flow', () => {
		save('org1', 'Beta handle');
		for (const extra of [{ kind: 'draft' as const }, { setup: false }, { setup: undefined }]) {
			const id = mk(extra);
			expect(view(id).customPieces).toHaveLength(0);
			expect(kinds(id)).not.toContain('custom.add');
		}
	});

	it('leaves out saved parts that are not marked and parts of other workspaces', () => {
		save('org1', 'Not default', { isDefault: false });
		save('org2', 'Other chapter', { isDefault: true });
		const id = mk();
		expect(view(id).customPieces).toHaveLength(0);
		const other = mk({}, 'org2', 'other');
		expect(loadBuildView(db, other, 'other')!.customPieces.map((c) => c.name)).toEqual([
			'Other chapter'
		]);
	});

	it('skips a part that cannot be added without failing the build', () => {
		save('org1', 'Empty', { plates: [] });
		save('org1', 'Good');
		const id = mk();
		expect(view(id).customPieces.map((c) => c.name)).toEqual(['Good']);
	});

	it('leaves no partial rows when a part fails after it was written', () => {
		save('org1', 'Late failure', { replaces: [kitSlug] });
		save('org1', 'Good');
		const id = mk();
		const v = view(id);
		expect(v.customPieces.map((c) => c.name)).toEqual(['Good']);
		expect(v.skipped.map((s) => s.slug)).not.toContain(kitSlug);
		const pieces = db
			.select()
			.from(buildCustomPieces)
			.where(eq(buildCustomPieces.buildId, id))
			.all();
		expect(pieces).toHaveLength(1);
		const orphanPlates = db
			.select()
			.from(buildPlates)
			.where(eq(buildPlates.buildId, id))
			.all()
			.filter((p) => p.source?.startsWith('custom:') && p.source !== `custom:${pieces[0].id}`);
		expect(orphanPlates).toHaveLength(0);
		const customParts = db
			.select()
			.from(buildParts)
			.where(and(eq(buildParts.buildId, id)))
			.all()
			.filter((p) => p.partSlug.startsWith('custom'));
		expect(customParts.length).toBe(v.parts.filter((p) => p.custom).length);
		expect(kinds(id).filter((x) => x === 'custom.add')).toHaveLength(1);
	});
});
