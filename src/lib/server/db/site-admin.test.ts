import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, runMigrations } from './index';
import { siteAdmin, user } from './schema';

function addUser(db: ReturnType<typeof openDb>, id: string) {
	db.insert(user)
		.values({ id, name: id, email: `${id}@example.test`, emailVerified: false })
		.run();
}

describe('site_admin table', () => {
	it('exists after migrate, defaults granted_at, cascades on user delete, nulls granted_by', () => {
		const db = openDb(':memory:');
		runMigrations(db);
		runMigrations(db); // idempotent
		addUser(db, 'a');
		addUser(db, 'b');
		db.insert(siteAdmin).values({ userId: 'a' }).run();
		db.insert(siteAdmin).values({ userId: 'b', grantedBy: 'a' }).run();
		const rows = db.select().from(siteAdmin).all();
		expect(rows).toHaveLength(2);
		expect(rows[0].grantedAt).toBeInstanceOf(Date);

		db.delete(user).where(eq(user.id, 'a')).run();
		const left = db.select().from(siteAdmin).all();
		expect(left).toHaveLength(1);
		expect(left[0].userId).toBe('b');
		expect(left[0].grantedBy).toBeNull();

		db.delete(user).where(eq(user.id, 'b')).run();
		expect(db.select().from(siteAdmin).all()).toHaveLength(0);
	});
});
