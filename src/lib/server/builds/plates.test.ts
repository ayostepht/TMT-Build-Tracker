import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { recomputeParts } from '#lib/domain/recompute.ts';
import { describeActivity } from '#lib/domain/activity.ts';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildUploads,
	builds,
	member,
	organization,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { makeProjectThreeMf } from '../threemf/fixtures';
import { parseThreeMfBytes } from '../threemf';
import { addRun, setPartStatus } from './actions';
import { createBuild } from './create';
import {
	applyUpload,
	buildLayouts,
	createUpload,
	discardUpload,
	plateThumbnailFile,
	setPlateLayout,
	uploadThumbnailFile
} from './plates';
import { onBuildEvents } from './test-helpers';
import { loadBuildView } from './view';

let db: Db;
let templateId: string;
const orgId = 'org1';
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-plates-')), 'unused.db');

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

const mk = (plateLayout?: string) =>
	createBuild(
		db,
		{ organizationId: orgId, templateId, designId: null, name: 'B', plateLayout },
		'owner'
	);
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const run = (id: string, over: Record<string, unknown>) =>
	addRun(db, id, 'owner', { date: '2026-03-01', result: 'Success', ...over });

describe('built-in layouts', () => {
	it('lists layouts and defaults to xpa', () => {
		const id = mk();
		const l = buildLayouts(db, id, 'owner');
		expect(l.layouts.map((x) => [x.key, x.plateCount])).toEqual([
			['xpa', 24],
			['h2d', 21]
		]);
		expect(l.current).toBe('xpa');
		expect(view(id).plates).toHaveLength(24);
		expect(view(id).plates[0].source).toBe('template');
	});

	it('a build can start on a layout; unknown keys are rejected', () => {
		const id = mk('h2d');
		const v = view(id);
		// default variants: the McMaster (8) and smaller-rim (20) plates and the two-piece parts are inactive
		expect(v.plates.map((p) => p.number)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21
		]);
		expect(v.plates.find((p) => p.number === 10)!.parts).toEqual([
			'headrest-mount',
			'headrest-brace',
			'headrest-bolt'
		]);
		expect(v.plates.find((p) => p.number === 12)!.runNote).toMatch(/Print 4 times/);
		expect(v.plates[0].source).toBe('layout:h2d');
		expect(db.select().from(builds).where(eq(builds.id, id)).get()!.plateLayout).toBe('h2d');
		expect(() => mk('nope')).toThrow(/Unknown plate layout/);
	});

	it('switches layout, writes activity and emits an event', () => {
		const id = mk();
		const events = onBuildEvents(id);
		const r = setPlateLayout(db, id, 'owner', { key: 'h2d' });
		expect(r).toEqual({ plates: 21, convertedRuns: 0 });
		expect(view(id).plates.find((p) => p.number === 1)!.source).toBe('layout:h2d');
		expect(buildLayouts(db, id, 'owner').current).toBe('h2d');
		expect(events.at(-1)?.kind).toBe('plates.layout');
		const a = db.select().from(activity).where(eq(activity.buildId, id)).all().at(-1)!;
		expect(a.kind).toBe('plates.layout');
		const text = describeActivity(
			{ id: 'x', userId: 'owner', userName: 'Owen', kind: a.kind, payload: a.payload, at: '' },
			view(id)
		);
		expect(text).toBe("Owen switched the plates to MakeGood's Bambu H2D / H2S profile (21 plates)");
		expect(() => setPlateLayout(db, id, 'owner', { key: 'zzz' })).toThrow(/Unknown plate layout/);
	});

	it('keeps viewers out', () => {
		const id = mk();
		expect(() => setPlateLayout(db, id, 'viewer', { key: 'h2d' })).toThrow(/cannot edit/);
		expect(() => setPlateLayout(db, id, 'outsider', { key: 'h2d' })).toThrow(ApiError);
	});
});

describe('replacing plates when print logs exist', () => {
	function withRuns() {
		const id = mk();
		// plate 1 (Handle Left) printed once; plate 10 (seat back: two parts) printed with grams and hours
		run(id, { plateNumber: 1, grams: 300, hours: 13 });
		run(id, { plateNumber: 10, grams: 100, hours: 7 });
		run(id, { plateNumber: 11, result: 'Failed', note: 'warped' });
		// a part log that is not attached to a plate
		run(id, { partSlug: 'wing-left', grams: 250 });
		return id;
	}

	it('answers 409 unless convertRuns is set, and changes nothing', () => {
		const id = withRuns();
		const before = view(id);
		try {
			setPlateLayout(db, id, 'owner', { key: 'h2d' });
			throw new Error('should have failed');
		} catch (e) {
			expect((e as ApiError).status).toBe(409);
		}
		const after = view(id);
		expect(after.plates).toEqual(before.plates);
		expect(after.runs).toHaveLength(4);
	});

	it('converts plate logs to part logs and leaves every status exactly as it was', () => {
		const id = withRuns();
		const before = view(id);
		const r = setPlateLayout(db, id, 'owner', { key: 'h2d', convertRuns: true });
		expect(r.convertedRuns).toBe(3);
		const after = view(id);
		expect(after.runs.every((x) => x.plateNumber === null && x.partSlug)).toBe(true);
		// the two-part seat back log is split per part, totals preserved
		const seat = after.runs.filter(
			(x) => x.partSlug === 'seat-back-top' || x.partSlug === 'seat-back-bottom'
		);
		expect(seat.map((x) => [x.grams, x.hours])).toEqual([
			[50, 3.5],
			[50, 3.5]
		]);
		expect(after.runs.reduce((a, x) => a + (x.grams ?? 0), 0)).toBe(650);
		expect(after.runs.find((x) => x.result === 'Failed')!.note).toBe('warped');
		// statuses untouched, and replaying the converted history gives the same statuses
		for (const slug of Object.keys(before.state)) {
			expect(after.state[slug].status).toBe(before.state[slug].status);
			expect(after.state[slug].printedOn).toBe(before.state[slug].printedOn);
		}
		expect(after.state['handle-left'].status).toBe('Printed');
		expect(after.state['seat-center'].status).toBe('Reprint');
		expect(recomputeParts(after, after.runs, Object.keys(after.state))).toEqual([]);
		expect(
			describeActivity(
				{
					id: 'x',
					userId: 'owner',
					userName: 'Owen',
					kind: 'plates.layout',
					payload: { name: 'H', plates: 21, convertedRuns: 3 },
					at: ''
				},
				after
			)
		).toContain('converted 3 print logs');
	});

	it('does not touch statuses for runs on plates that are partly done', () => {
		const id = mk();
		run(id, { plateNumber: 13, partSlug: 'rims-1-4' }); // 1 of 2 runs: Printing-ish, not Printed
		setPartStatus(db, id, 'owner', 'rims-2-3', { status: 'Printing' });
		const before = view(id).state;
		setPlateLayout(db, id, 'owner', { key: 'h2d', convertRuns: true });
		expect(view(id).state).toEqual(before);
	});
});

describe('uploading a 3MF', () => {
	async function upload(id: string, plates = 'full') {
		const bytes = makeProjectThreeMf({
			sliced: true,
			filamentTypes: ['PETG', 'TPU'],
			plates:
				plates === 'full'
					? [
							{
								name: 'HANDLES',
								prediction: 47000,
								weight: 330,
								filaments: { 1: 330 },
								objects: [
									{ name: '3DTMT A1 HANDLE LEFT REV A.STEP' },
									{ name: '3DTMT A2 HANDLE RIGHT REV A.STEP' },
									{ name: 'Mystery gadget' }
								]
							},
							{
								name: 'WHEEL RIM (PRINT X4)',
								prediction: 35000,
								filaments: { 1: 120, 2: 12.5 },
								objects: [{ name: '3DTMT O WHEEL RIM REV A.STEP' }]
							},
							{ name: 'EMPTY', objects: [{ name: 'Nothing mapped' }] }
						]
					: [{ name: 'X', objects: [{ name: '3DTMT H SEAT CENTER REV A.STEP' }] }]
		});
		const parsed = await parseThreeMfBytes(bytes);
		return createUpload(
			db,
			id,
			'owner',
			{ name: 'chair.3mf', size: bytes.length },
			parsed,
			view(id)
		);
	}

	it('suggests a mapping, filament roles and variants without sending thumbnail bytes', async () => {
		const id = mk();
		const up = await upload(id);
		expect(JSON.stringify(up.summary)).not.toContain('thumbnail":{');
		expect(up.summary.plates[0].hasThumbnail).toBe(true);
		const s = up.suggestions;
		const obj = (pl: number, name: string) =>
			up.summary.plates.find((p) => p.index === pl)!.objects.find((o) => o.name === name)!;
		expect(s.mapping[`1:${obj(1, '3DTMT A1 HANDLE LEFT REV A.STEP').id}`]).toBe('handle-left');
		expect(s.mapping[`1:${obj(1, 'Mystery gadget').id}`]).toBeNull();
		expect(s.variantChoices).toEqual({ rim: 'smaller' });
		expect(s.filamentMap['1']).toBe('primary'); // handles are primary PETG
		expect(s.filamentMap['2']).toBe('soft'); // first TPU role
		expect(uploadThumbnailFile(db, id, 'owner', up.uploadId, 1)).toMatch(/plate_1\.png$/);
	});

	it('applies the mapping: plates, grams per role, runs, thumbnails, variants, activity', async () => {
		const id = mk();
		const up = await upload(id);
		const key = (pl: number, name: string) =>
			`${pl}:${up.summary.plates.find((p) => p.index === pl)!.objects.find((o) => o.name === name)!.id}`;
		const events = onBuildEvents(id);
		const r = applyUpload(db, id, 'owner', up.uploadId, {
			mapping: {
				...up.suggestions.mapping,
				[key(1, 'Mystery gadget')]: 'storage-left'
			},
			filamentMap: { '1': 'accent', '2': 'tire' },
			variantChoices: up.suggestions.variantChoices
		});
		expect(r).toEqual({
			plates: 2,
			skipped: 1,
			convertedRuns: 0,
			mode: 'plates',
			learned: 5,
			arranged: false
		});
		const v = view(id);
		expect(v.variantChoices.rim).toBe('smaller');
		expect(v.plates.map((p) => p.number)).toEqual([1, 2]);
		const [handles, rim] = v.plates;
		expect(handles).toMatchObject({
			name: 'HANDLES',
			estSeconds: 47000,
			runs: 1,
			slicerGrams: 330,
			filamentGrams: { accent: 330 },
			source: `upload:${up.uploadId}`
		});
		expect(handles.parts).toEqual(['handle-left', 'handle-right', 'storage-left']);
		expect(rim).toMatchObject({ runs: 4, filamentGrams: { accent: 120, tire: 12.5 } });
		expect(rim.parts).toEqual(['rims-small-1-4']);
		// thumbnails: served from the build folder, upload folder cleaned up
		expect(plateThumbnailFile(db, id, 'owner', 1)).toMatch(/plates\/.+\/1\.png$/);
		expect(existsSync(plateThumbnailFile(db, id, 'owner', 1)!)).toBe(true);
		expect(() => uploadThumbnailFile(db, id, 'owner', up.uploadId, 1)).toThrow(/Not found/);
		expect(handles.thumbnailPath).toBe(`plates/${id}/1.png`);
		expect(db.select().from(buildUploads).get()!.status).toBe('applied');
		expect(events.at(-1)?.kind).toBe('plates.upload');
		expect(buildLayouts(db, id, 'owner').current).toBe('upload');
		const a = db.select().from(activity).where(eq(activity.buildId, id)).all().at(-1)!;
		expect(
			describeActivity(
				{ id: 'x', userId: 'owner', userName: 'Owen', kind: a.kind, payload: a.payload, at: '' },
				v
			)
		).toBe('Owen organized the plates from chair.3mf (2 plates)');
		// the plate is done: re-applying the same upload is refused
		expect(() =>
			applyUpload(db, id, 'owner', up.uploadId, { mapping: up.suggestions.mapping })
		).toThrow(/already/);
	});

	it('requires convertRuns when logs are attached to plates', async () => {
		const id = mk();
		run(id, { plateNumber: 1 });
		const up = await upload(id);
		const body = { mapping: up.suggestions.mapping, filamentMap: up.suggestions.filamentMap };
		expect(() => applyUpload(db, id, 'owner', up.uploadId, body)).toThrow(/print log/);
		try {
			applyUpload(db, id, 'owner', up.uploadId, body);
		} catch (e) {
			expect((e as ApiError).status).toBe(409);
		}
		expect(view(id).plates).toHaveLength(24);
		const r = applyUpload(db, id, 'owner', up.uploadId, { ...body, convertRuns: true });
		expect(r.convertedRuns).toBe(1);
		const v = view(id);
		expect(v.runs.map((x) => [x.plateNumber, x.partSlug])).toEqual([[null, 'handle-left']]);
		expect(v.state['handle-left'].status).toBe('Printed');
	});

	it('validates the body and permissions', async () => {
		const id = mk();
		const up = await upload(id);
		expect(() =>
			applyUpload(db, id, 'owner', up.uploadId, { mapping: { '1:2': 'no-such-part' } })
		).toThrow(/Unknown part/);
		expect(() => applyUpload(db, id, 'owner', up.uploadId, { mapping: {} })).toThrow(
			/at least one/
		);
		expect(() =>
			applyUpload(db, id, 'owner', up.uploadId, {
				mapping: up.suggestions.mapping,
				filamentMap: { '1': 'nope' }
			})
		).toThrow(/Unknown filament/);
		expect(() =>
			applyUpload(db, id, 'owner', up.uploadId, {
				mapping: up.suggestions.mapping,
				variantChoices: { rim: 'huge' }
			})
		).toThrow(/Unknown option/);
		expect(() =>
			applyUpload(db, id, 'viewer', up.uploadId, { mapping: up.suggestions.mapping })
		).toThrow(/cannot edit/);
		expect(() =>
			applyUpload(db, id, 'outsider', up.uploadId, { mapping: up.suggestions.mapping })
		).toThrow(/Not found/);
		const other = mk();
		expect(() =>
			applyUpload(db, other, 'owner', up.uploadId, { mapping: up.suggestions.mapping })
		).toThrow(/Upload not found/);
		expect(() => discardUpload(db, id, 'viewer', up.uploadId)).toThrow(/cannot edit/);
	});

	it('discards an upload and its files; a new upload replaces an unapplied one', async () => {
		const id = mk();
		const first = await upload(id);
		const second = await upload(id, 'small');
		expect(
			db.select().from(buildUploads).where(eq(buildUploads.id, first.uploadId)).get()!.status
		).toBe('discarded');
		expect(() => uploadThumbnailFile(db, id, 'owner', first.uploadId, 1)).toThrow(ApiError);
		discardUpload(db, id, 'owner', second.uploadId);
		expect(
			db.select().from(buildUploads).where(eq(buildUploads.id, second.uploadId)).get()!.status
		).toBe('discarded');
		expect(() =>
			applyUpload(db, id, 'owner', second.uploadId, { mapping: second.suggestions.mapping })
		).toThrow(/already/);
	});
});
