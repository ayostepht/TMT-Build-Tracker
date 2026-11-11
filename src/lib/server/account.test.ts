import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createAuth, type Auth } from './auth';
import { ApiError } from './access';
import { decideNewUser } from './auth-policy';
import { deleteAccount, exportAccountData, planAccountDeletion } from './account';
import { createBuild } from './builds/create';
import { openDb, runMigrations, type Db } from './db';
import {
	account,
	activity,
	buildPhotos,
	builds,
	colorDesigns,
	invitation,
	member,
	organization,
	session,
	templates,
	user,
	verification
} from './db/schema';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';
import { findPersonalWorkspace } from './teams';

let db: Db;
let auth: Auth;
let dir: string;
let templateId: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'tmt-account-'));
	vi.stubEnv('DATABASE_URL', join(dir, 'tmt.db'));
	vi.stubEnv('BETTER_AUTH_SECRET', 'a'.repeat(40));
	for (const k of ['TMT_MODE', 'PUBLIC_URL', 'ADMIN_EMAILS', 'SIGNUP']) vi.stubEnv(k, '');
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	auth = createAuth(db);
});
afterEach(() => vi.unstubAllEnvs());

async function signUp(name: string, email: string) {
	const res = await auth.api.signUpEmail({
		body: { name, email, password: 'correct-horse-battery' },
		returnHeaders: true
	});
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	return { id: res.response.user.id, cookie };
}

/** A real request through Better Auth's handler, as the browser would send it. */
function post(path: string, cookie: string, body: unknown) {
	return auth.handler(
		new Request(`http://localhost/api/auth${path}`, {
			method: 'POST',
			headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost' },
			body: JSON.stringify(body)
		})
	);
}

describe('organization quotas through the plugin endpoints', () => {
	it('chaptersPerUser refuses the second chapter with a sentence; personal does not count', async () => {
		await signUp('Admin', 'admin@example.test'); // first user is the site admin: exempt
		const u = await signUp('Pat', 'pat@example.test');
		vi.stubEnv('QUOTA_CHAPTERS_PER_USER', '1');
		const a = await post('/organization/create', u.cookie, { name: 'One', slug: 'one' });
		expect(a.status).toBe(200);
		const b = await post('/organization/create', u.cookie, { name: 'Two', slug: 'two' });
		expect(b.status).toBe(409);
		const body = (await b.json()) as { message: string; code: string };
		expect(body.message).toContain('You already created 1 chapter');
		expect(body.code).toBe('QUOTA');
		expect(
			db.select().from(organization).where(eq(organization.slug, 'two')).get()
		).toBeUndefined();
	});

	it('exempts site admins', async () => {
		const admin = await signUp('Admin', 'admin@example.test');
		vi.stubEnv('QUOTA_CHAPTERS_PER_USER', '0');
		const r = await post('/organization/create', admin.cookie, { name: 'A', slug: 'a' });
		expect(r.status).toBe(200);
	});

	it('membershipsPerUser blocks creating and joining', async () => {
		await signUp('Admin', 'admin@example.test');
		const owner = await signUp('Owner', 'owner@example.test');
		const guest = await signUp('Guest', 'guest@example.test');
		await post('/organization/create', owner.cookie, { name: 'C1', slug: 'c1' });
		await post('/organization/create', guest.cookie, { name: 'G1', slug: 'g1' });
		const org = db.select().from(organization).where(eq(organization.slug, 'c1')).get()!;
		const inv = await post('/organization/invite-member', owner.cookie, {
			email: 'guest@example.test',
			role: 'viewer',
			organizationId: org.id
		});
		expect(inv.status).toBe(200);
		const { id } = (await inv.json()) as { id: string };
		vi.stubEnv('QUOTA_MEMBERSHIPS_PER_USER', '1');
		const acc = await post('/organization/accept-invitation', guest.cookie, { invitationId: id });
		expect(acc.status).toBeGreaterThanOrEqual(400);
		expect(((await acc.json()) as { message: string }).message).toContain(
			'already belong to 1 chapter'
		);
		expect(db.select().from(member).where(eq(member.organizationId, org.id)).all()).toHaveLength(1);
		const c2 = await post('/organization/create', guest.cookie, { name: 'G2', slug: 'g2' });
		expect(c2.status).toBe(409);
	});

	it('membersPerChapter and pendingInvitesPerChapter', async () => {
		await signUp('Admin', 'admin@example.test');
		const owner = await signUp('Owner', 'owner@example.test');
		const guest = await signUp('Guest', 'guest@example.test');
		await post('/organization/create', owner.cookie, { name: 'C1', slug: 'c1' });
		const org = db.select().from(organization).where(eq(organization.slug, 'c1')).get()!;
		vi.stubEnv('QUOTA_PENDING_INVITES_PER_CHAPTER', '1');
		const invite = (email: string) =>
			post('/organization/invite-member', owner.cookie, {
				email,
				role: 'viewer',
				organizationId: org.id
			});
		const first = await invite('guest@example.test');
		expect(first.status).toBe(200);
		const second = await invite('other@example.test');
		expect(second.status).toBe(409);
		expect(((await second.json()) as { message: string }).message).toContain('open invitation');
		vi.stubEnv('QUOTA_MEMBERS_PER_CHAPTER', '1');
		const { id } = (await first.json()) as { id: string };
		const acc = await post('/organization/accept-invitation', guest.cookie, { invitationId: id });
		expect(acc.status).toBeGreaterThanOrEqual(400);
		expect(((await acc.json()) as { message: string }).message).toContain('already has 1 member');
	});

	it('disables organization/update (it could clear the personal flag)', async () => {
		await signUp('Admin', 'admin@example.test');
		const u = await signUp('Pat', 'pat@example.test');
		const personal = findPersonalWorkspace(db, u.id)!;
		for (const path of [
			'/organization/update',
			'/organization/leave',
			'/organization/check-slug'
		]) {
			const r = await post(path, u.cookie, {
				organizationId: personal.id,
				data: { metadata: {} },
				slug: 'x'
			});
			expect(r.status, path).toBe(404);
		}
	});
});

describe('account caps', () => {
	it('refuses new accounts at accountsTotal but lets admins and existing users in', async () => {
		await signUp('First', 'first@example.test');
		vi.stubEnv('QUOTA_ACCOUNTS_TOTAL', '1');
		const cfg = { publicMode: false, signup: 'open' as const };
		const d = decideNewUser(db, { email: 'new@example.test' }, cfg);
		expect(d).toMatchObject({ ok: false, code: 'signups_paused' });
		expect(d.ok ? '' : d.message).toBe('This server is not taking new accounts right now.');
		await expect(
			auth.api.signUpEmail({
				body: { name: 'New', email: 'new@example.test', password: 'correct-horse-battery' }
			})
		).rejects.toThrow('This server is not taking new accounts right now.');
		// existing user still signs in
		await expect(
			auth.api.signInEmail({
				body: { email: 'first@example.test', password: 'correct-horse-battery' }
			})
		).resolves.toBeTruthy();
		vi.stubEnv('ADMIN_EMAILS', 'boss@example.test');
		expect(decideNewUser(db, { email: 'boss@example.test' }, cfg).ok).toBe(true);
	});

	it('signupsPerDay counts only the last 24 hours', async () => {
		await signUp('First', 'first@example.test');
		vi.stubEnv('QUOTA_SIGNUPS_PER_DAY', '1');
		const cfg = { publicMode: false, signup: 'open' as const };
		expect(decideNewUser(db, { email: 'n@example.test' }, cfg).ok).toBe(false);
		expect(
			decideNewUser(db, { email: 'n@example.test' }, cfg, new Date(Date.now() + 25 * 3600 * 1000))
				.ok
		).toBe(true);
	});

	it('public mode keeps requiring verified emails, caps apply after', () => {
		vi.stubEnv('QUOTA_ACCOUNTS_TOTAL', '0');
		const cfg = { publicMode: true, signup: 'open' as const };
		expect(decideNewUser(db, { email: 'a@example.test', emailVerified: false }, cfg)).toMatchObject(
			{
				code: 'email_not_verified'
			}
		);
		expect(decideNewUser(db, { email: 'a@example.test', emailVerified: true }, cfg)).toMatchObject({
			code: 'signups_paused'
		});
	});
});

// ---- deletion matrix

function writeUpload(rel: string) {
	const p = join(dir, 'uploads', rel);
	mkdirSync(join(p, '..'), { recursive: true });
	writeFileSync(p, 'x');
	return p;
}

function addChapter(id: string, members: [string, string][]) {
	db.insert(organization)
		.values({ id, name: `Chapter ${id}`, slug: id, createdAt: new Date() })
		.run();
	members.forEach(([userId, role], i) =>
		db
			.insert(member)
			.values({
				id: `m-${id}-${userId}`,
				organizationId: id,
				userId,
				role,
				createdAt: new Date(1000 + i)
			})
			.run()
	);
}

function addBuild(orgId: string, userId: string, kind: 'build' | 'draft' = 'build') {
	return createBuild(
		db,
		{ organizationId: orgId, templateId, designId: null, name: 'B', kind },
		userId
	);
}

function addPhotoRow(buildId: string, userId: string) {
	const rel = `photos/${buildId}/p.webp`;
	const abs = writeUpload(rel);
	db.insert(buildPhotos).values({ buildId, kind: 'progress', path: rel, createdBy: userId }).run();
	return abs;
}

describe('deleteAccount', () => {
	it('deletes the personal workspace with files, keeps chapter builds, and scrubs the person', async () => {
		await signUp('Admin', 'admin@example.test');
		const pat = await signUp('Pat', 'pat@example.test');
		const lee = await signUp('Lee', 'lee@example.test');
		const personal = findPersonalWorkspace(db, pat.id)!;
		const mine = addBuild(personal.id, pat.id);
		const myDraft = addBuild(personal.id, pat.id, 'draft');
		const photo = addPhotoRow(mine, pat.id);
		addChapter('c1', [
			[lee.id, 'owner'],
			[pat.id, 'editor']
		]);
		const shared = addBuild('c1', pat.id);
		const sharedPhoto = addPhotoRow(shared, pat.id);
		const chapterDraft = addBuild('c1', pat.id, 'draft');
		// a design with a preview
		const [dsg] = db
			.insert(colorDesigns)
			.values({ templateId, slug: 'd-pat', name: 'D', authorUserId: pat.id })
			.returning({ id: colorDesigns.id })
			.all();
		const designPng = writeUpload(`designs/${dsg.id}.png`);
		db.insert(verification)
			.values({
				id: 'v1',
				identifier: 'pat@example.test',
				value: 'x',
				expiresAt: new Date(Date.now() + 1e6)
			})
			.run();
		db.insert(invitation)
			.values({
				id: 'i1',
				organizationId: 'c1',
				email: 'someone@example.test',
				status: 'pending',
				expiresAt: new Date(Date.now() + 1e6),
				inviterId: pat.id
			})
			.run();
		const act = db.select().from(activity).where(eq(activity.buildId, shared)).all();
		void act;

		const res = await deleteAccount(db, pat.id);
		expect(res.leftChapters).toEqual(['Chapter c1']);
		expect(db.select().from(user).where(eq(user.id, pat.id)).get()).toBeUndefined();
		expect(
			db.select().from(organization).where(eq(organization.id, personal.id)).get()
		).toBeUndefined();
		expect(db.select().from(builds).where(eq(builds.id, mine)).get()).toBeUndefined();
		expect(db.select().from(builds).where(eq(builds.id, myDraft)).get()).toBeUndefined();
		expect(db.select().from(builds).where(eq(builds.id, chapterDraft)).get()).toBeUndefined();
		const kept = db.select().from(builds).where(eq(builds.id, shared)).get()!;
		expect(kept.createdBy).toBe(lee.id);
		expect(existsSync(photo)).toBe(false);
		expect(existsSync(sharedPhoto)).toBe(true);
		expect(existsSync(designPng)).toBe(false);
		expect(db.select().from(colorDesigns).where(eq(colorDesigns.id, dsg.id)).get()).toBeUndefined();
		expect(db.select().from(session).where(eq(session.userId, pat.id)).all()).toHaveLength(0);
		expect(db.select().from(account).where(eq(account.userId, pat.id)).all()).toHaveLength(0);
		expect(db.select().from(verification).all()).toHaveLength(0);
		expect(db.select().from(invitation).where(eq(invitation.id, 'i1')).get()).toBeUndefined();
		expect(
			db
				.select()
				.from(member)
				.where(and(eq(member.userId, pat.id)))
				.all()
		).toHaveLength(0);
		// others untouched
		expect(db.select().from(user).where(eq(user.id, lee.id)).get()).toBeTruthy();
		expect(findPersonalWorkspace(db, lee.id)).toBeTruthy();
		// the activity left in the chapter no longer names anyone
		for (const a of db.select().from(activity).where(eq(activity.buildId, shared)).all())
			expect(a.userId).toBeNull();
	});

	it('refuses when the user is the only owner of a chapter with other members', async () => {
		await signUp('Admin', 'admin@example.test');
		const pat = await signUp('Pat', 'pat@example.test');
		const lee = await signUp('Lee', 'lee@example.test');
		addChapter('c1', [
			[pat.id, 'owner'],
			[lee.id, 'viewer']
		]);
		const before = db.select().from(user).all().length;
		await expect(deleteAccount(db, pat.id)).rejects.toThrow(
			'Make someone else an owner of Chapter c1 first'
		);
		expect(db.select().from(user).all()).toHaveLength(before);
		expect(planAccountDeletion(db, pat.id).find((f) => f.orgId === 'c1')?.fate).toBe('blocked');
		// once someone else owns it, it goes through
		db.update(member)
			.set({ role: 'owner' })
			.where(eq(member.id, `m-c1-${lee.id}`))
			.run();
		await expect(deleteAccount(db, pat.id)).resolves.toBeTruthy();
	});

	it('deletes a chapter where the user is the only member, with its files', async () => {
		await signUp('Admin', 'admin@example.test');
		const pat = await signUp('Pat', 'pat@example.test');
		addChapter('solo', [[pat.id, 'owner']]);
		const b = addBuild('solo', pat.id);
		const photo = addPhotoRow(b, pat.id);
		const res = await deleteAccount(db, pat.id);
		expect(res.deletedWorkspaces).toContain('Chapter solo');
		expect(db.select().from(organization).where(eq(organization.id, 'solo')).get()).toBeUndefined();
		expect(existsSync(photo)).toBe(false);
		expect(existsSync(join(dir, 'uploads', 'photos', b))).toBe(false);
	});

	it('unknown user is a 404', async () => {
		await expect(deleteAccount(db, 'nobody')).rejects.toBeInstanceOf(ApiError);
	});
});

describe('kit copies used from another workspace', () => {
	function copyFor(orgId: string) {
		const id = `copy-${orgId}`;
		db.insert(templates)
			.values({
				id,
				slug: id,
				name: 'Copy',
				version: '1',
				ownerOrgId: orgId,
				baseTemplateId: templateId
			} as never)
			.run();
		return id;
	}

	it('account deletion leaves a chapter build that used the personal kit copy on the base kit', async () => {
		await signUp('Admin', 'admin@example.test');
		const pat = await signUp('Pat', 'pat@example.test');
		const lee = await signUp('Lee', 'lee@example.test');
		const personal = findPersonalWorkspace(db, pat.id)!;
		addChapter('c1', [
			[pat.id, 'owner'],
			[lee.id, 'owner']
		]);
		const copy = copyFor(personal.id);
		const b = addBuild('c1', pat.id);
		db.update(builds).set({ templateId: copy }).where(eq(builds.id, b)).run();
		await expect(deleteAccount(db, pat.id)).resolves.toBeTruthy();
		const row = db.select().from(builds).where(eq(builds.id, b)).get()!;
		expect(row.templateId).toBe(templateId);
		expect(db.select().from(templates).where(eq(templates.id, copy)).get()).toBeUndefined();
	});

	it('chapter deletion likewise re-points builds elsewhere', async () => {
		await signUp('Admin', 'admin@example.test');
		const owner = await signUp('Owner', 'owner@example.test');
		const r = await post('/organization/create', owner.cookie, { name: 'Gone', slug: 'gone' });
		const org = (await r.json()) as { id: string };
		const copy = copyFor(org.id);
		const personal = findPersonalWorkspace(db, owner.id)!;
		const b = addBuild(personal.id, owner.id);
		db.update(builds).set({ templateId: copy }).where(eq(builds.id, b)).run();
		const del = await post('/organization/delete', owner.cookie, { organizationId: org.id });
		expect(del.status).toBe(200);
		expect(db.select().from(builds).where(eq(builds.id, b)).get()!.templateId).toBe(templateId);
	});
});

describe('chapter deletion removes files (plugin endpoint)', () => {
	it('removes photos after the transaction', async () => {
		await signUp('Admin', 'admin@example.test');
		const owner = await signUp('Owner', 'owner@example.test');
		const r = await post('/organization/create', owner.cookie, { name: 'Gone', slug: 'gone' });
		const org = (await r.json()) as { id: string };
		const b = addBuild(org.id, owner.id);
		const photo = addPhotoRow(b, owner.id);
		const del = await post('/organization/delete', owner.cookie, { organizationId: org.id });
		expect(del.status).toBe(200);
		expect(db.select().from(builds).where(eq(builds.id, b)).get()).toBeUndefined();
		expect(existsSync(photo)).toBe(false);
	});
});

describe('exportAccountData', () => {
	it('has profile, memberships and personal builds, photos by name only', async () => {
		await signUp('Admin', 'admin@example.test');
		const pat = await signUp('Pat', 'pat@example.test');
		const personal = findPersonalWorkspace(db, pat.id)!;
		const b = addBuild(personal.id, pat.id);
		addPhotoRow(b, pat.id);
		addChapter('c1', [[pat.id, 'editor']]);
		addBuild('c1', pat.id);
		const data = JSON.parse(exportAccountData(db, pat.id)) as {
			profile: { email: string };
			memberships: { name: string; personal: boolean; role: string }[];
			builds: { build: { id: string }; photos: { fileName: string }[] }[];
		};
		expect(data.profile.email).toBe('pat@example.test');
		expect(data.memberships.map((m) => m.name).sort()).toEqual(['Chapter c1', 'My builds']);
		expect(data.builds).toHaveLength(1);
		expect(data.builds[0].build.id).toBe(b);
		expect(data.builds[0].photos).toEqual([expect.objectContaining({ fileName: 'p.webp' })]);
		expect(JSON.stringify(data)).not.toContain(dir);
	});
});

describe('last site admin', () => {
	it('refuses the only site admin while other accounts exist, with a code', async () => {
		const admin = await signUp('Admin', 'admin@example.test');
		await signUp('Pat', 'pat@example.test');
		await expect(deleteAccount(db, admin.id)).rejects.toMatchObject({
			status: 409,
			code: 'last_admin'
		});
		expect(db.select().from(user).where(eq(user.id, admin.id)).get()).toBeTruthy();
	});

	it('lets them go once another account is a site admin (ADMIN_EMAILS)', async () => {
		const admin = await signUp('Admin', 'admin@example.test');
		await signUp('Pat', 'pat@example.test');
		vi.stubEnv('ADMIN_EMAILS', 'pat@example.test');
		await expect(deleteAccount(db, admin.id)).resolves.toBeTruthy();
	});

	it('refuses the only account on the server', async () => {
		const only = await signUp('Admin', 'admin@example.test');
		await expect(deleteAccount(db, only.id)).rejects.toMatchObject({ code: 'only_account' });
	});

	it('public mode: an unverified listed email is not an admin, so it is not the last one', async () => {
		vi.stubEnv('TMT_MODE', 'public');
		vi.stubEnv('ADMIN_EMAILS', 'boss@example.test, real@example.test');
		const mk = (id: string, verified: boolean) =>
			db
				.insert(user)
				.values({ id, name: id, email: `${id}@example.test`, emailVerified: verified })
				.run();
		mk('boss', false);
		mk('real', true);
		mk('pat', true);
		// real is the only verified admin: refused
		await expect(deleteAccount(db, 'real')).rejects.toMatchObject({ code: 'last_admin' });
		// boss is listed but unverified: not an admin, deletable
		await expect(deleteAccount(db, 'boss')).resolves.toBeTruthy();
	});
});
