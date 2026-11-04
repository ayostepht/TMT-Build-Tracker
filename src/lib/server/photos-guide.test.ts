import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError, isSiteAdmin } from './access';
import { openDb, runMigrations, type Db } from './db';
import { activity, member, organization, templateGuidePages, templates, user } from './db/schema';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';
import { createBuild } from './builds/create';
import { addPhoto, deletePhoto, readPhoto } from './builds/photos';
import { loadBuildView } from './builds/view';
import { assertTemplateAdmin } from './models/guard';
import { clearGuide, guideStatus, readGuidePage, saveGuidePage, setGuideMapping } from './guide';
import { sniffImage, stripImageMetadata } from './images';

process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-photos-')), 'unused.db');

const PNG = Uint8Array.from(
	atob(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
	),
	(c) => c.charCodeAt(0)
);

const status = async (p: Promise<unknown>) => {
	try {
		await p;
	} catch (e) {
		return (e as ApiError).status;
	}
	return 0;
};

let db: Db;
let templateId: string;
let buildId: string;

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: 'org1', name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	// Created in this order so "first" is the site admin.
	for (const [i, u] of ['first', 'editor', 'viewer', 'outsider'].entries())
		db.insert(user)
			.values({
				id: u,
				name: `User ${u}`,
				email: `${u}@example.test`,
				createdAt: new Date(2026, 0, 1 + i)
			})
			.run();
	for (const [u, role] of [
		['first', 'owner'],
		['editor', 'editor'],
		['viewer', 'viewer']
	])
		db.insert(member)
			.values({ id: `m-${u}`, organizationId: 'org1', userId: u, role, createdAt: new Date() })
			.run();
	buildId = createBuild(
		db,
		{ organizationId: 'org1', templateId, designId: null, name: 'Chair' },
		'first'
	);
});

describe('photos', () => {
	it('stores a PNG, lists it, serves it to members only, and deletes it', async () => {
		const id = await addPhoto(db, buildId, 'editor', {
			kind: 'progress',
			caption: ' side ',
			width: '1',
			height: 1,
			file: PNG,
			thumb: PNG
		});
		const v = loadBuildView(db, buildId, 'viewer')!;
		expect(v.photos).toHaveLength(1);
		expect(v.photos[0]).toMatchObject({
			id,
			kind: 'progress',
			caption: 'side',
			createdByName: 'User editor'
		});
		expect(db.select().from(activity).where(eq(activity.kind, 'photo.add')).all()).toHaveLength(1);
		const got = await readPhoto(db, buildId, 'viewer', id, false);
		expect(got.type).toBe('image/png');
		expect((await readPhoto(db, buildId, 'viewer', id, true)).bytes.length).toBeGreaterThan(0);
		expect(await status(readPhoto(db, buildId, 'outsider', id, false))).toBe(404);
		expect(await status(deletePhoto(db, buildId, 'viewer', id))).toBe(403);
		await deletePhoto(db, buildId, 'editor', id);
		expect(loadBuildView(db, buildId, 'editor')!.photos).toHaveLength(0);
		expect(await status(readPhoto(db, buildId, 'editor', id, false))).toBe(404);
	});

	it('validates who, kind, type and size', async () => {
		const ok = { kind: 'finished', file: PNG };
		expect(await status(addPhoto(db, buildId, 'viewer', ok))).toBe(403);
		expect(await status(addPhoto(db, buildId, 'outsider', ok))).toBe(404);
		expect(await status(addPhoto(db, buildId, 'editor', { ...ok, kind: 'selfie' }))).toBe(400);
		expect(
			await status(
				addPhoto(db, buildId, 'editor', { ...ok, file: new TextEncoder().encode('<svg onload=1>') })
			)
		).toBe(400);
		expect(await status(addPhoto(db, buildId, 'editor', { ...ok, file: new Uint8Array(0) }))).toBe(
			400
		);
		const big = new Uint8Array(8 * 1024 * 1024 + 1);
		big.set(PNG);
		expect(await status(addPhoto(db, buildId, 'editor', { ...ok, file: big }))).toBe(413);
		expect(loadBuildView(db, buildId, 'editor')!.photos).toHaveLength(0);
	});
});

describe('metadata stripping', () => {
	const u8 = (...n: number[]) => Uint8Array.from(n);
	it('removes EXIF from a JPEG but keeps the image segments', () => {
		const exif = u8(0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00); // APP1 "Exif"
		const jpeg = Uint8Array.from([
			0xff,
			0xd8,
			...exif,
			0xff,
			0xdb,
			0x00,
			0x04,
			1,
			2,
			0xff,
			0xda,
			0x00,
			0x02,
			9,
			9,
			0xff,
			0xd9
		]);
		const out = stripImageMetadata(jpeg, 'image/jpeg');
		expect(sniffImage(out)).toBe('image/jpeg');
		expect(out.length).toBe(jpeg.length - exif.length);
		expect(Buffer.from(out).includes(Buffer.from('Exif'))).toBe(false);
	});
	it('removes text and EXIF chunks from a PNG', () => {
		const chunk = (type: string, data: number[]) => {
			const b = new Uint8Array(12 + data.length);
			new DataView(b.buffer).setUint32(0, data.length);
			b.set(
				[...type].map((c) => c.charCodeAt(0)),
				4
			);
			b.set(data, 8);
			return b;
		};
		const png = Uint8Array.from([
			...PNG.subarray(0, 8),
			...chunk('eXIf', [1, 2, 3]),
			...chunk('tEXt', [65, 0, 66]),
			...PNG.subarray(8)
		]);
		const out = stripImageMetadata(png, 'image/png');
		expect(out.length).toBe(PNG.length);
		expect(Buffer.from(out).includes(Buffer.from('tEXt'))).toBe(false);
	});
	it('removes EXIF from a WebP and fixes the sizes', () => {
		const vp8l = [0x56, 0x50, 0x38, 0x4c, 4, 0, 0, 0, 1, 2, 3, 4];
		const exif = [0x45, 0x58, 0x49, 0x46, 4, 0, 0, 0, 9, 9, 9, 9];
		const vp8x = [0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0];
		const body = [...'WEBP'].map((c) => c.charCodeAt(0)).concat(vp8x, vp8l, exif);
		const webp = Uint8Array.from(
			[...'RIFF'].map((c) => c.charCodeAt(0)).concat(body.length, 0, 0, 0, body)
		);
		const out = stripImageMetadata(webp, 'image/webp');
		expect(sniffImage(out)).toBe('image/webp');
		expect(out.length).toBe(webp.length - exif.length);
		expect(out[4]).toBe(out.length - 8);
		expect(out[20]).toBe(0); // EXIF flag cleared
	});
});

describe('guide pages', () => {
	it('only site admins pass the template guard', () => {
		const get = (id: string) => ({ id, email: `${id}@example.test` });
		expect(isSiteAdmin(db, get('first'))).toBe(true);
		expect(() => assertTemplateAdmin(db, get('first'), templateId)).not.toThrow();
		for (const u of ['editor', 'viewer', 'outsider'])
			expect(() => assertTemplateAdmin(db, get(u), templateId)).toThrow(ApiError);
		expect(() => assertTemplateAdmin(db, get('first'), 'missing')).toThrow(ApiError);
	});

	it('accepts images only (3 MB cap), maps our pages to PDF pages and serves them', async () => {
		expect(await status(saveGuidePage(templateId, 3, new TextEncoder().encode('%PDF-1.4')))).toBe(
			400
		);
		expect(await status(saveGuidePage(templateId, 0, PNG))).toBe(400);
		const big = new Uint8Array(3 * 1024 * 1024 + 1);
		big.set(PNG);
		expect(await status(saveGuidePage(templateId, 3, big))).toBe(413);

		await saveGuidePage(templateId, 15, PNG);
		await saveGuidePage(templateId, 16, PNG);
		expect((await guideStatus(db, templateId)).uploaded).toEqual([15, 16]);
		expect(await status(setGuideMapping(db, templateId, { 18: 99 }))).toBe(400); // not uploaded
		expect(await status(setGuideMapping(db, templateId, { 4: 15 }))).toBe(400); // not one of our pages
		expect(await setGuideMapping(db, templateId, { 18: 15, 19: 16 })).toBe(2);

		const view = () => loadBuildView(db, buildId, 'viewer')!.guidePages;
		expect(
			view()
				.filter((g) => g.hasImage)
				.map((g) => g.page)
		).toEqual([18, 19]);
		const f = await readGuidePage(db, templateId, 18);
		expect(f.type).toBe('image/png');
		expect(await status(readGuidePage(db, templateId, 14))).toBe(404);

		await setGuideMapping(db, templateId, { 18: null });
		expect(
			view()
				.filter((g) => g.hasImage)
				.map((g) => g.page)
		).toEqual([19]);
		await clearGuide(db, templateId);
		expect(view().some((g) => g.hasImage)).toBe(false);
		expect((await guideStatus(db, templateId)).uploaded).toEqual([]);
		expect(db.select().from(templateGuidePages).all().length).toBeGreaterThan(0);
	});
});
