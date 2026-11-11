import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, runMigrations, type Db } from '../db';
import { member, organization, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { openUploadSlots } from '../quota';
import { saveGuidePage, MAX_GUIDE_PAGES } from '../guide';
import { defaultTemplate, forkTemplate } from './fork';

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('#lib/server/db/index.ts', async (orig) => ({
	...(await orig<object>()),
	getDb: () => h.db
}));

const PNG = Uint8Array.from(
	atob(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
	),
	(c) => c.charCodeAt(0)
);
const MB = 1048576;

let db: Db;
let dir: string;
let copyId: string;
let baseId: string;
const owner = { id: 'owner', email: 'owner@example.test', emailVerified: false };

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'tmt-kit-upload-'));
	vi.stubEnv('DATABASE_URL', join(dir, 'tmt.db'));
	vi.stubEnv('TMT_MODE', 'public');
	vi.stubEnv('PUBLIC_URL', 'https://example.test');
	vi.stubEnv('QUOTA_UPLOAD_MB_PER_WORKSPACE', '1');
	db = openDb(':memory:');
	h.db = db;
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	db.insert(organization)
		.values({ id: 'org1', name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	// Created first: the first user is the site admin in self-host mode; in public mode admins come from ADMIN_EMAILS.
	for (const u of ['boss', 'owner'])
		db.insert(user)
			.values({ id: u, name: u, email: `${u}@example.test`, emailVerified: u === 'boss' })
			.run();
	db.insert(member)
		.values({
			id: 'm1',
			organizationId: 'org1',
			userId: 'owner',
			role: 'owner',
			createdAt: new Date()
		})
		.run();
	vi.stubEnv('ADMIN_EMAILS', 'boss@example.test');
	baseId = defaultTemplate(db).id;
	copyId = forkTemplate(db, 'org1', baseId, 'Copy', 'owner');
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dir, { recursive: true, force: true });
});

const geoCall = async (user = owner, id = copyId) => {
	const { POST } = await import('../../../routes/api/templates/[id]/print-geometry/+server');
	const request = new Request('http://x/g?name=a.3mf', {
		method: 'POST',
		body: new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]),
		headers: { 'content-type': 'application/octet-stream' }
	});
	return POST({ params: { id }, request, url: new URL(request.url), locals: { user } } as never);
};
const imports = () => {
	const d = join(dir, 'uploads', 'imports');
	return existsSync(d) ? readdirSync(d) : [];
};
const fillCopy = (bytes: number) => {
	mkdirSync(join(dir, 'uploads', 'guide', copyId), { recursive: true });
	writeFileSync(join(dir, 'uploads', 'guide', copyId, '1.png'), new Uint8Array(bytes));
};

describe('print-geometry POST', () => {
	it('public mode: a copy manager gets 403, a site admin does not', async () => {
		const res = await geoCall();
		expect(res.status).toBe(403);
		expect((await res.json()).error).toMatch(/site admin/);
		expect(imports()).toEqual([]);
		const boss = await geoCall({ id: 'boss', email: 'boss@example.test', emailVerified: true });
		expect(boss.status).not.toBe(403);
	});

	describe('self-host', () => {
		beforeEach(() => {
			vi.stubEnv('TMT_MODE', 'selfhost');
			vi.stubEnv('QUOTA_UPLOAD_MB_PER_WORKSPACE', '1');
		});

		it('429 when the upload slots are taken, before any file', async () => {
			vi.stubEnv('QUOTA_CONCURRENT_UPLOADS_PER_USER', '0');
			const res = await geoCall();
			expect(res.status).toBe(429);
			expect(imports()).toEqual([]);
			expect(openUploadSlots('owner')).toBe(0);
		});

		it('409 when the workspace is already over, before any file', async () => {
			fillCopy(MB + 10);
			const res = await geoCall();
			expect(res.status).toBe(409);
			expect((await res.json()).code).toBe('quota');
			expect(imports()).toEqual([]);
			expect(openUploadSlots('owner')).toBe(0);
		});

		it('507 when the disk is nearly full, before any file', async () => {
			vi.stubEnv('MIN_FREE_DISK_MB', String(1024 ** 4));
			const res = await geoCall();
			expect(res.status).toBe(507);
			expect(imports()).toEqual([]);
			expect(openUploadSlots('owner')).toBe(0);
		});

		it('a bad file is a 400, not a 403, and leaves nothing behind', async () => {
			const res = await geoCall();
			expect(res.status).toBe(400);
			expect(imports()).toEqual([]);
			expect(openUploadSlots('owner')).toBe(0);
		});
	});
});

describe('guide page upload', () => {
	const q = () => ({ db, userId: 'owner' });
	const guideFiles = () => {
		const d = join(dir, 'uploads', 'guide', copyId);
		return existsSync(d) ? readdirSync(d) : [];
	};
	const status = async (p: Promise<unknown>) => {
		try {
			await p;
		} catch (e) {
			return (e as { status: number }).status;
		}
		return 0;
	};

	it('refuses a page that pushes the workspace over and leaves no file', async () => {
		fillCopy(MB - 20);
		expect(await status(saveGuidePage(copyId, 2, PNG, q()))).toBe(409);
		expect(guideFiles()).toEqual(['1.png']);
	});

	it('replacing a page counts only the difference', async () => {
		fillCopy(MB - 5); // page 1 exists
		// a replacement of page 1 by a smaller image fits even though the copy is nearly full
		await saveGuidePage(copyId, 1, PNG, q());
		expect(guideFiles()).toEqual(['1.png']);
	});

	it('caps the page count per template and leaves no new file', async () => {
		mkdirSync(join(dir, 'uploads', 'guide', copyId), { recursive: true });
		for (let i = 1; i <= MAX_GUIDE_PAGES; i++)
			writeFileSync(join(dir, 'uploads', 'guide', copyId, `${i}.png`), PNG);
		expect(await status(saveGuidePage(copyId, MAX_GUIDE_PAGES + 1, PNG, q()))).toBe(409);
		expect(guideFiles()).toHaveLength(MAX_GUIDE_PAGES);
		await saveGuidePage(copyId, 5, PNG, q()); // replacing is still fine
	});

	it('the route answers 507 on a full disk and frees its slot', async () => {
		vi.stubEnv('MIN_FREE_DISK_MB', String(1024 ** 4));
		const { POST } = await import('../../../routes/api/templates/[id]/guide/pages/[n]/+server');
		const request = new Request('http://x/p', { method: 'POST', body: PNG });
		const res = await POST({
			params: { id: copyId, n: '3' },
			request,
			url: new URL(request.url),
			locals: { user: owner }
		} as never);
		expect(res.status).toBe(507);
		expect(guideFiles()).toEqual([]);
		expect(openUploadSlots('owner')).toBe(0);
	});
});

describe('guide image GET', () => {
	it('is a 404 for a signed-in user outside the copy', async () => {
		db.insert(user).values({ id: 'out', name: 'o', email: 'out@example.test' }).run();
		const { GET } = await import('../../../routes/api/templates/[id]/guide/[page].webp/+server');
		const call = (u: object) =>
			GET({
				params: { id: copyId, page: '1' },
				request: new Request('http://x/g'),
				locals: { user: u }
			} as never);
		const res = await call({ id: 'out', email: 'out@example.test', emailVerified: true });
		expect(res.status).toBe(404);
	});
});
