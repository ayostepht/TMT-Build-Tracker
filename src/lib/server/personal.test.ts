import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createAuth, type Auth } from './auth';
import { ApiError } from './access';
import { moveBuild } from './builds/actions';
import { createBuild } from './builds/create';
import { openDb, runMigrations, type Db } from './db';
import { activity, builds, member, organization, templates, user } from './db/schema';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';
import { ensurePersonalWorkspace, findPersonalWorkspace, listTeams } from './teams';

let db: Db;
let auth: Auth;
let templateId: string;

async function signUp(name: string, email: string) {
	const res = await auth.api.signUpEmail({
		body: { name, email, password: 'correct-horse-battery' },
		returnHeaders: true
	});
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	return { id: res.response.user.id, headers: new Headers({ cookie }) };
}

function addChapter(id: string, userId: string, role: string) {
	db.insert(organization)
		.values({ id, name: `Chapter ${id}`, slug: id, createdAt: new Date() })
		.run();
	db.insert(member)
		.values({ id: `m-${id}-${userId}`, organizationId: id, userId, role, createdAt: new Date() })
		.run();
}

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	auth = createAuth(db);
});

describe('personal workspace', () => {
	it('sign-up creates exactly one, owned by the user, and makes it active', async () => {
		const u = await signUp('Pat Maker', 'pat@example.test');
		const teams = listTeams(db, u.id);
		expect(teams).toHaveLength(1);
		expect(teams[0]).toMatchObject({ personal: true, role: 'owner', name: "Pat Maker's builds" });
		expect(db.select().from(organization).all()).toHaveLength(1);
		const session = await auth.api.getSession({ headers: u.headers });
		expect(session?.session.activeOrganizationId).toBe(teams[0].id);
	});

	it('gets a unique slug when two users share a name', async () => {
		await signUp('Pat', 'a@example.test');
		await signUp('Pat', 'b@example.test');
		const slugs = db.select({ slug: organization.slug }).from(organization).all();
		expect(new Set(slugs.map((s) => s.slug)).size).toBe(2);
	});

	it('is created lazily for a legacy user, once', () => {
		db.insert(user).values({ id: 'legacy', name: 'Old Timer', email: 'old@example.test' }).run();
		expect(findPersonalWorkspace(db, 'legacy')).toBeNull();
		const a = ensurePersonalWorkspace(db, { id: 'legacy', name: 'Old Timer' });
		const b = ensurePersonalWorkspace(db, { id: 'legacy', name: 'Old Timer' });
		expect(a.created).toBe(true);
		expect(b).toEqual({ id: a.id, created: false });
		expect(listTeams(db, 'legacy').filter((t) => t.personal)).toHaveLength(1);
	});

	it('rejects invitations', async () => {
		const u = await signUp('Pat', 'pat@example.test');
		const personal = findPersonalWorkspace(db, u.id)!;
		await expect(
			auth.api.createInvitation({
				body: { email: 'friend@example.test', role: 'viewer', organizationId: personal.id },
				headers: u.headers
			})
		).rejects.toThrow();
		// A real chapter still accepts invitations.
		const org = await auth.api.createOrganization({
			body: { name: 'Real chapter', slug: 'real-chapter' },
			headers: u.headers
		});
		const inv = await auth.api.createInvitation({
			body: { email: 'friend@example.test', role: 'viewer', organizationId: org.id },
			headers: u.headers
		});
		expect(inv.status).toBe('pending');
	});

	it('cannot be created through the organization API', async () => {
		const u = await signUp('Pat', 'pat@example.test');
		await expect(
			auth.api.createOrganization({
				body: { name: 'Sneaky', slug: 'sneaky', metadata: { personal: true } },
				headers: u.headers
			})
		).rejects.toThrow();
	});
});

describe('moveBuild', () => {
	async function setup() {
		const u = await signUp('Pat', 'pat@example.test');
		const personal = findPersonalWorkspace(db, u.id)!;
		const buildId = createBuild(
			db,
			{ organizationId: personal.id, templateId, designId: null, name: 'Chair' },
			u.id
		);
		return { u, personal, buildId };
	}
	const orgOf = (id: string) =>
		db.select({ o: builds.organizationId }).from(builds).where(eq(builds.id, id)).get()!.o;

	it('works for an owner who is editor in the target chapter, and logs it', async () => {
		const { u, buildId } = await setup();
		addChapter('c1', u.id, 'editor');
		moveBuild(db, buildId, u.id, { organizationId: 'c1' });
		expect(orgOf(buildId)).toBe('c1');
		const row = db
			.select()
			.from(activity)
			.where(and(eq(activity.buildId, buildId), eq(activity.kind, 'build.move')))
			.get();
		expect(row?.payload).toMatchObject({ to: 'c1', toName: 'Chapter c1' });
	});

	it('rejects viewers of the target, non-members and personal targets', async () => {
		const { u, personal, buildId } = await setup();
		addChapter('viewer-c', u.id, 'viewer');
		db.insert(user).values({ id: 'someone-else', name: 'S', email: 's@example.test' }).run();
		addChapter('foreign', 'someone-else', 'owner');
		const move = (to: string) => () => moveBuild(db, buildId, u.id, { organizationId: to });
		expect(move('viewer-c')).toThrowError(expect.objectContaining({ status: 403 }));
		expect(move('foreign')).toThrowError(expect.objectContaining({ status: 404 }));
		expect(move(personal.id)).toThrow(ApiError);
		expect(orgOf(buildId)).toBe(personal.id);
	});

	it('is owner-only on the source and only from a personal workspace', async () => {
		const { u, buildId } = await setup();
		const other = await signUp('Other', 'other@example.test');
		addChapter('c2', other.id, 'owner');
		expect(() => moveBuild(db, buildId, other.id, { organizationId: 'c2' })).toThrowError(
			expect.objectContaining({ status: 404 })
		);
		// A build already in a chapter cannot be moved between chapters.
		addChapter('c3', u.id, 'owner');
		moveBuild(db, buildId, u.id, { organizationId: 'c3' });
		addChapter('c4', u.id, 'owner');
		expect(() => moveBuild(db, buildId, u.id, { organizationId: 'c4' })).toThrow(ApiError);
	});
});

describe('deleting a personal workspace', () => {
	it('is refused while it holds builds', async () => {
		const u = await signUp('Pat', 'pat@example.test');
		const personal = findPersonalWorkspace(db, u.id)!;
		createBuild(
			db,
			{ organizationId: personal.id, templateId, designId: null, name: 'Chair' },
			u.id
		);
		await expect(
			auth.api.deleteOrganization({ body: { organizationId: personal.id }, headers: u.headers })
		).rejects.toThrow();
		expect(findPersonalWorkspace(db, u.id)).not.toBeNull();
	});
});
