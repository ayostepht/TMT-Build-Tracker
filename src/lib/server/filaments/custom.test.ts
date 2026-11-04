import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import { member, organization, user } from '../db/schema';
import {
	DuplicateFilamentError,
	createCustomFilament,
	deleteCustomFilament,
	listCustomFilaments,
	updateCustomFilament
} from './custom';

let db: Db;
const body = (o: Record<string, unknown> = {}) => ({
	brand: 'TestBrand',
	material: 'PETG HF',
	colorName: 'Team Red',
	hex: '#D31F26',
	...o
});
const status = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		if (e instanceof ApiError) return e.status;
		throw e;
	}
	return 0;
};

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	for (const id of ['org1', 'org2'])
		db.insert(organization).values({ id, name: id, slug: id, createdAt: new Date() }).run();
	for (const [u, org, role] of [
		['owner', 'org1', 'owner'],
		['editor', 'org1', 'editor'],
		['viewer', 'org1', 'viewer'],
		['outsider', 'org2', 'owner']
	]) {
		db.insert(user)
			.values({ id: u, name: u, email: `${u}@example.test`, createdAt: new Date() })
			.run();
		db.insert(member)
			.values({ id: `m-${u}`, organizationId: org, userId: u, role, createdAt: new Date() })
			.run();
	}
});

describe('custom filaments', () => {
	it('editors create, members list, normalized', () => {
		const f = createCustomFilament(db, 'org1', 'editor', body({ finish: 'Silk', notes: ' hi ' }));
		expect(f).toMatchObject({ brand: 'TestBrand', hex: '#d31f26', finish: 'silk', notes: 'hi' });
		expect(listCustomFilaments(db, 'org1', 'viewer').map((x) => x.id)).toEqual([f.id]);
	});

	it('permissions: viewer 403, outsider 404', () => {
		expect(status(() => createCustomFilament(db, 'org1', 'viewer', body()))).toBe(403);
		expect(status(() => createCustomFilament(db, 'org1', 'outsider', body()))).toBe(404);
		expect(status(() => listCustomFilaments(db, 'org1', 'outsider'))).toBe(404);
		const f = createCustomFilament(db, 'org1', 'owner', body());
		expect(status(() => updateCustomFilament(db, f.id, 'viewer', body()))).toBe(403);
		expect(status(() => updateCustomFilament(db, f.id, 'outsider', body()))).toBe(404);
		expect(status(() => deleteCustomFilament(db, f.id, 'viewer'))).toBe(403);
		expect(status(() => deleteCustomFilament(db, f.id, 'outsider'))).toBe(404);
		expect(status(() => deleteCustomFilament(db, 'nope', 'owner'))).toBe(404);
	});

	it('scopes filaments to the workspace', () => {
		createCustomFilament(db, 'org1', 'owner', body());
		createCustomFilament(db, 'org2', 'outsider', body({ brand: 'Other' }));
		expect(listCustomFilaments(db, 'org2', 'outsider').map((x) => x.brand)).toEqual(['Other']);
	});

	it('duplicate brand+type+name is 409 with the existing id', () => {
		const f = createCustomFilament(db, 'org1', 'owner', body());
		try {
			createCustomFilament(
				db,
				'org1',
				'editor',
				body({ brand: ' testbrand', colorName: 'team  red' })
			);
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(DuplicateFilamentError);
			expect((e as DuplicateFilamentError).status).toBe(409);
			expect((e as DuplicateFilamentError).existingId).toBe(f.id);
		}
		// Same color in another workspace is fine; a different type is fine.
		createCustomFilament(db, 'org2', 'outsider', body());
		createCustomFilament(db, 'org1', 'owner', body({ material: 'PETG' }));
		// Renaming onto another filament's identity conflicts; keeping your own does not.
		const g = createCustomFilament(db, 'org1', 'owner', body({ colorName: 'Blue' }));
		expect(() => updateCustomFilament(db, g.id, 'owner', body())).toThrow(DuplicateFilamentError);
		expect(
			updateCustomFilament(db, g.id, 'owner', body({ colorName: 'Blue', hex: '#0000ff' })).hex
		).toBe('#0000ff');
	});

	it('update and delete', () => {
		const f = createCustomFilament(db, 'org1', 'owner', body());
		const u = updateCustomFilament(
			db,
			f.id,
			'editor',
			body({ colorName: 'Fire Red', url: 'https://example.com/p' })
		);
		expect(u).toMatchObject({ colorName: 'Fire Red', url: 'https://example.com/p' });
		expect(u.updatedAt).not.toBeNull();
		deleteCustomFilament(db, f.id, 'editor');
		expect(listCustomFilaments(db, 'org1', 'owner')).toEqual([]);
	});

	it.each([
		['bad hex', { hex: 'red' }],
		['short hex', { hex: '#fff' }],
		['no brand', { brand: ' ' }],
		['no material', { material: '' }],
		['no color name', { colorName: undefined }],
		['long brand', { brand: 'x'.repeat(61) }],
		['long notes', { notes: 'x'.repeat(501) }],
		['bad finish', { finish: 'rainbow' }],
		['bad link', { url: 'javascript:alert(1)' }],
		['non-text brand', { brand: 5 }]
	])('rejects %s with 400', (_n, o) => {
		expect(status(() => createCustomFilament(db, 'org1', 'owner', body(o)))).toBe(400);
	});

	it('rejects a non-object body', () => {
		expect(status(() => createCustomFilament(db, 'org1', 'owner', null))).toBe(400);
	});
});
