import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError } from './access';
import { respond } from './api';
import { openDb, runMigrations, type Db } from './db';
import {
	activity,
	builds,
	member,
	organization,
	printRuns,
	templateParts,
	templates,
	user
} from './db/schema';
import { session } from './db/auth.schema';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';
import { createBuild } from './builds/create';
import { addRun, moveBuild, promoteDraft, updateBuild } from './builds/actions';
import { repointBuildsOffTemplates } from './builds/repoint';
import { forkTemplate } from './templates/fork';
import { addPhoto } from './builds/photos';
import { createCustomFilament } from './filaments/custom';
import { createDesign } from './designs/designs';
import { liveStream, sessionStillValid } from './live-stream';
import {
	acquireSseSlot,
	assertUnder,
	assertUploadRoom,
	countBuilds,
	enforceStreamedUpload,
	MAX_ACTIVITY_PER_BUILD,
	MAX_RUNS_PER_BUILD,
	openSseSlots,
	QuotaError
} from './quota';
import { writeFileSync } from 'node:fs';

let db: Db;
let templateId: string;
let dir: string;
const orgId = 'org1';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'tmt-quota-'));
	vi.stubEnv('DATABASE_URL', join(dir, 'tmt.db'));
	vi.stubEnv('TMT_MODE', 'public');
	vi.stubEnv('PUBLIC_URL', 'https://example.test');
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	db.insert(organization)
		.values({ id: 'org2', name: 'Other', slug: 'other', createdAt: new Date() })
		.run();
	for (const u of ['u1', 'u2', 'boss']) {
		db.insert(user)
			.values({ id: u, name: u, email: `${u}@example.test`, emailVerified: u === 'boss' })
			.run();
		for (const o of [orgId, 'org2'])
			db.insert(member)
				.values({
					id: `m-${u}-${o}`,
					organizationId: o,
					userId: u,
					role: 'owner',
					createdAt: new Date()
				})
				.run();
	}
});

afterEach(() => vi.unstubAllEnvs());

const mk = (userId = 'u1', kind: 'build' | 'draft' = 'build', org = orgId) =>
	createBuild(db, { organizationId: org, templateId, designId: null, name: 'B', kind }, userId);

const quota409 = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		expect(e).toBeInstanceOf(QuotaError);
		expect((e as QuotaError).status).toBe(409);
		expect((e as QuotaError).code).toBe('quota');
		return (e as QuotaError).message;
	}
	throw new Error('expected a quota refusal');
};

describe('builds and drafts', () => {
	it('refuses at the limit with a clear sentence and a 409 + code body', async () => {
		vi.stubEnv('QUOTA_BUILDS_PER_WORKSPACE', '2');
		mk();
		mk();
		const msg = quota409(() => mk());
		expect(msg).toBe(
			'This workspace already has 2 builds, the limit on this server. Delete one or ask the admin.'
		);
		const res = await respond(() => mk());
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: msg, code: 'quota' });
		// Another workspace is unaffected.
		expect(mk('u1', 'build', 'org2')).toBeTruthy();
	});

	it('counts drafts per user, not against the build limit', () => {
		vi.stubEnv('QUOTA_BUILDS_PER_WORKSPACE', '1');
		vi.stubEnv('QUOTA_DRAFTS_PER_USER', '2');
		mk('u1', 'draft');
		mk('u1', 'draft');
		mk('u1', 'build');
		expect(quota409(() => mk('u1', 'draft'))).toMatch(/already have 2 drafts/);
		mk('u2', 'draft');
	});

	it('is unlimited with a null limit and never runs the count', () => {
		vi.stubEnv('TMT_MODE', 'selfhost');
		for (let i = 0; i < 15; i++) mk();
		const count = vi.fn(() => 999);
		assertUnder(db, 'buildsPerWorkspace', count, { userId: 'u1' });
		expect(count).not.toHaveBeenCalled();
	});

	it('exempts site admins and nobody else', () => {
		vi.stubEnv('QUOTA_BUILDS_PER_WORKSPACE', '1');
		vi.stubEnv('ADMIN_EMAILS', 'boss@example.test');
		mk('u1');
		quota409(() => mk('u2'));
		mk('boss');
		mk('boss');
		expect(countBuilds(db, orgId)).toBe(3);
	});

	it('lets exactly one of two parallel creates at limit-1 through', async () => {
		vi.stubEnv('QUOTA_BUILDS_PER_WORKSPACE', '3');
		mk();
		mk();
		const results = await Promise.allSettled([
			Promise.resolve().then(() => mk('u1')),
			Promise.resolve().then(() => mk('u2'))
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
		expect(countBuilds(db, orgId)).toBe(3);
	});

	it('refuses promoting a draft and moving a build into a full workspace', () => {
		vi.stubEnv('QUOTA_BUILDS_PER_WORKSPACE', '1');
		mk();
		const d = mk('u1', 'draft');
		quota409(() => promoteDraft(db, d, 'u1'));
		expect(db.select().from(builds).where(eq(builds.id, d)).get()!.kind).toBe('draft');
		// Moving needs a personal source workspace.
		db.update(organization)
			.set({ metadata: JSON.stringify({ personal: true, userId: 'u1' }) })
			.where(eq(organization.id, 'org2'))
			.run();
		const b = mk('u1', 'build', 'org2');
		quota409(() => moveBuild(db, b, 'u1', { organizationId: orgId }));
		expect(db.select().from(builds).where(eq(builds.id, b)).get()!.organizationId).toBe('org2');
	});
});

describe('custom filaments and designs', () => {
	it('limits custom filaments per workspace', () => {
		vi.stubEnv('QUOTA_CUSTOM_FILAMENTS_PER_WORKSPACE', '1');
		const f = (n: string) =>
			createCustomFilament(db, orgId, 'u1', {
				brand: 'A',
				material: 'PLA',
				colorName: n,
				hex: '#112233'
			});
		f('one');
		expect(quota409(() => f('two'))).toMatch(/already has 1 custom filament/);
	});

	it('limits saved designs per user', () => {
		vi.stubEnv('QUOTA_SAVED_DESIGNS_PER_USER', '1');
		const b = mk();
		createDesign(db, 'u1', { buildId: b, name: 'One' });
		expect(quota409(() => createDesign(db, 'u1', { buildId: b, name: 'Two' }))).toMatch(
			/already have 1 saved design/
		);
	});
});

describe('photos and upload bytes', () => {
	const jpeg = (n: number) => {
		const b = new Uint8Array(n);
		b.set([0xff, 0xd8, 0xff, 0xda]);
		return b;
	};
	const add = (buildId: string, n = 1000) =>
		addPhoto(db, buildId, 'u1', { kind: 'progress', file: jpeg(n) });
	const files = (buildId: string) => {
		const p = join(dir, 'uploads', 'photos', buildId);
		return existsSync(p) ? readdirSync(p) : [];
	};

	it('limits photos per build and writes nothing when refused', async () => {
		vi.stubEnv('QUOTA_PHOTOS_PER_BUILD', '1');
		const b = mk();
		await add(b);
		await expect(add(b)).rejects.toMatchObject({ status: 409, code: 'quota' });
		expect(files(b)).toHaveLength(1);
	});

	it('lets exactly one of two parallel uploads at limit-1 through, leaving no stray file', async () => {
		vi.stubEnv('QUOTA_PHOTOS_PER_BUILD', '1');
		const b = mk();
		const r = await Promise.allSettled([add(b), add(b)]);
		expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
		expect(files(b)).toHaveLength(1);
	});

	it('counts bytes from the stored files, not declared sizes', async () => {
		vi.stubEnv('QUOTA_UPLOAD_MB_PER_WORKSPACE', '1');
		const b = mk();
		await add(b, 600_000);
		await expect(add(b, 600_000)).rejects.toMatchObject({ status: 409, code: 'quota' });
		expect(files(b)).toHaveLength(1);
		await add(b, 300_000);
	});

	it('refuses a streamed file that pushes the workspace over, and deletes it', async () => {
		vi.stubEnv('QUOTA_UPLOAD_MB_PER_WORKSPACE', '1');
		const b = mk();
		await add(b, 600_000);
		const f = join(dir, 'streamed.bin');
		writeFileSync(f, new Uint8Array(600_000));
		await expect(enforceStreamedUpload(db, orgId, f, { userId: 'u1' })).rejects.toBeInstanceOf(
			QuotaError
		);
		expect(existsSync(f)).toBe(false);
		// "Already over?" pre-check with zero bytes passes while under.
		assertUploadRoom(db, orgId, 0, { userId: 'u1' });
	});

	it('null byte limit is unlimited', async () => {
		vi.stubEnv('QUOTA_UPLOAD_MB_PER_WORKSPACE', 'off');
		const b = mk();
		await add(b, 3_000_000);
		await add(b, 3_000_000);
		expect(files(b)).toHaveLength(2);
	});
});

describe('live-stream slots', () => {
	it('caps per user with a 429 quota error and frees the slot on release', () => {
		vi.stubEnv('QUOTA_SSE_CONNECTIONS_PER_USER', '2');
		const u = { id: 'u1', email: 'u1@example.test', emailVerified: false };
		const a = acquireSseSlot(db, u);
		acquireSseSlot(db, u);
		try {
			acquireSseSlot(db, u);
			throw new Error('expected refusal');
		} catch (e) {
			expect(e).toBeInstanceOf(QuotaError);
			expect((e as QuotaError).status).toBe(429);
			expect((e as QuotaError).code).toBe('quota');
		}
		a();
		a(); // idempotent
		expect(openSseSlots('u1')).toBe(1);
		acquireSseSlot(db, u);
		expect(openSseSlots('u1')).toBe(2);
	});

	it('exempts admins', () => {
		vi.stubEnv('QUOTA_SSE_CONNECTIONS_PER_USER', '1');
		vi.stubEnv('ADMIN_EMAILS', 'boss@example.test');
		const u = { id: 'boss', email: 'boss@example.test', emailVerified: true };
		acquireSseSlot(db, u);
		acquireSseSlot(db, u);
		expect(openSseSlots('boss')).toBe(2);
	});

	it('releases the slot when the client disconnects (abort and cancel)', async () => {
		vi.stubEnv('QUOTA_SSE_CONNECTIONS_PER_USER', '3');
		const u = { id: 'u2', email: 'u2@example.test', emailVerified: false };
		const ac = new AbortController();
		const res = liveStream({
			signal: ac.signal,
			subscribe: () => () => {},
			allowed: () => true,
			release: acquireSseSlot(db, u)
		});
		expect(openSseSlots('u2')).toBe(1);
		ac.abort();
		expect(openSseSlots('u2')).toBe(0);
		void res;

		const res2 = liveStream({
			signal: new AbortController().signal,
			subscribe: () => () => {},
			allowed: () => true,
			release: acquireSseSlot(db, u)
		});
		expect(openSseSlots('u2')).toBe(1);
		await res2.body!.cancel();
		expect(openSseSlots('u2')).toBe(0);
	});

	it('stops sending and frees the slot once the user lost access', async () => {
		let ok = true;
		let fire: (e: unknown) => void = () => {};
		const release = acquireSseSlot(db, { id: 'u2', email: null, emailVerified: false });
		const res = liveStream({
			signal: new AbortController().signal,
			subscribe: (fn) => {
				fire = fn as (e: unknown) => void;
				return () => {};
			},
			allowed: () => ok,
			release
		});
		const reader = res.body!.getReader();
		await reader.read(); // connected
		fire({ n: 1 });
		expect(new TextDecoder().decode((await reader.read()).value)).toContain('"n":1');
		ok = false;
		fire({ n: 2 });
		expect((await reader.read()).done).toBe(true);
		expect(openSseSlots('u2')).toBe(0);
	});
});

describe('ApiError path', () => {
	it('plain ApiErrors keep their old body shape', async () => {
		const res = await respond(() => {
			throw new ApiError(400, 'nope');
		});
		expect(await res.json()).toEqual({ error: 'nope' });
	});
});

describe('per-user bytes and the disk floor', () => {
	const jpeg = (n: number) => {
		const b = new Uint8Array(n);
		b.set([0xff, 0xd8, 0xff, 0xda]);
		return b;
	};
	const add = (buildId: string, n = 1000) =>
		addPhoto(db, buildId, 'u1', { kind: 'progress', file: jpeg(n) });

	it('sums the workspaces a user owns against uploadBytesPerUser', async () => {
		vi.stubEnv('QUOTA_UPLOAD_MB_PER_WORKSPACE', 'off');
		vi.stubEnv('QUOTA_UPLOAD_MB_PER_USER', '1');
		await add(mk('u1', 'build', orgId), 600_000);
		await expect(add(mk('u1', 'build', 'org2'), 600_000)).rejects.toMatchObject({
			status: 409,
			code: 'quota'
		});
		await add(mk('u1', 'build', 'org2'), 300_000);
	});

	it('is unlimited when off', async () => {
		vi.stubEnv('QUOTA_UPLOAD_MB_PER_USER', 'off');
		await add(mk(), 3_000_000);
		await expect(add(mk(), 3_000_000)).resolves.toBeTruthy();
	});

	it('refuses photos and design previews with 507 below the disk floor', async () => {
		vi.stubEnv('MIN_FREE_DISK_MB', '999999999999');
		await expect(add(mk())).rejects.toMatchObject({ status: 507 });
	});
});

describe('row caps', () => {
	it('refuses a run past MAX_RUNS_PER_BUILD', () => {
		const b = mk();
		const slug = db.select().from(templateParts).get()!.slug;
		const rows = Array.from({ length: MAX_RUNS_PER_BUILD }, () => ({
			buildId: b,
			partSlug: slug,
			date: '2026-01-01',
			result: 'Success',
			note: ''
		}));
		for (let i = 0; i < rows.length; i += 500)
			db.insert(printRuns)
				.values(rows.slice(i, i + 500))
				.run();
		expect(() =>
			addRun(db, b, 'u1', { partSlug: slug, date: '2026-01-02', result: 'Success' })
		).toThrow(/at most 2000 print logs/);
	});

	it('prunes activity to the newest N per build', () => {
		const b = mk();
		const at = (i: number) => new Date(1_000_000 + i);
		const rows = Array.from({ length: MAX_ACTIVITY_PER_BUILD + 300 }, (_, i) => ({
			buildId: b,
			userId: 'u1',
			kind: 'build.update',
			payload: {},
			at: at(i)
		}));
		for (let i = 0; i < rows.length; i += 500)
			db.insert(activity)
				.values(rows.slice(i, i + 500))
				.run();
		updateBuild(db, b, 'u1', { name: 'Renamed' });
		const left = db.select().from(activity).where(eq(activity.buildId, b)).all();
		expect(left).toHaveLength(MAX_ACTIVITY_PER_BUILD);
		// The oldest are gone, the new row stays.
		expect(Math.min(...left.map((r) => r.at.getTime()))).toBeGreaterThan(1_000_300);
		expect(left.some((r) => (r.payload as { name?: string }).name === 'Renamed')).toBe(true);
	});
});

describe('kit copies stay in their workspace', () => {
	it("refuses a build on another workspace's copy, allows the owner", () => {
		const copy = forkTemplate(db, orgId, templateId, 'Copy', 'u1');
		expect(() =>
			createBuild(db, { organizationId: 'org2', templateId: copy, designId: null, name: 'B' }, 'u1')
		).toThrow(/Unknown template/);
		expect(
			createBuild(db, { organizationId: orgId, templateId: copy, designId: null, name: 'B' }, 'u1')
		).toBeTruthy();
	});

	it('moving a build out of the copy owner re-points it to the base kit', () => {
		db.update(organization)
			.set({ metadata: JSON.stringify({ personal: true, userId: 'u1' }) })
			.where(eq(organization.id, 'org2'))
			.run();
		const copy = forkTemplate(db, 'org2', templateId, 'Mine', 'u1');
		const b = createBuild(
			db,
			{ organizationId: 'org2', templateId: copy, designId: null, name: 'B' },
			'u1'
		);
		moveBuild(db, b, 'u1', { organizationId: orgId });
		expect(db.select().from(builds).where(eq(builds.id, b)).get()!.templateId).toBe(templateId);
	});

	it('repointBuildsOffTemplates moves only builds of other workspaces', () => {
		const copy = forkTemplate(db, orgId, templateId, 'Copy', 'u1');
		const own = createBuild(
			db,
			{ organizationId: orgId, templateId: copy, designId: null, name: 'own' },
			'u1'
		);
		// A legacy foreign reference (what older data may hold).
		const foreign = mk('u1', 'build', 'org2');
		db.update(builds).set({ templateId: copy }).where(eq(builds.id, foreign)).run();
		expect(db.transaction((tx) => repointBuildsOffTemplates(tx as unknown as Db, [copy]))).toBe(1);
		const t = (id: string) => db.select().from(builds).where(eq(builds.id, id)).get()!.templateId;
		expect(t(foreign)).toBe(templateId);
		expect(t(own)).toBe(copy);
	});
});

describe('live-stream session check', () => {
	it('closes on the next heartbeat once the session is gone', async () => {
		const release = vi.fn();
		let valid = true;
		const res = liveStream({
			signal: new AbortController().signal,
			subscribe: () => () => {},
			allowed: () => true,
			sessionValid: () => valid,
			release,
			heartbeatMs: 10
		});
		const reader = res.body!.getReader();
		await reader.read();
		valid = false;
		for (let i = 0; i < 20; i++) if ((await reader.read()).done) break;
		expect(release).toHaveBeenCalledTimes(1);
	});

	it('sessionStillValid looks the session up and honours expiry', () => {
		const row = (id: string, ms: number) => ({
			id,
			token: `t-${id}`,
			userId: 'u1',
			expiresAt: new Date(Date.now() + ms),
			updatedAt: new Date()
		});
		db.insert(session)
			.values([row('s-ok', 60_000), row('s-old', -1000)])
			.run();
		expect(sessionStillValid(db, 's-ok')).toBe(true);
		expect(sessionStillValid(db, 's-old')).toBe(false);
		expect(sessionStillValid(db, 'nope')).toBe(false);
		expect(sessionStillValid(db, undefined)).toBe(false);
	});
});
