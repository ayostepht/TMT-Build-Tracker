import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEGACY_CHAIN, normalizeWs } from './baseline-upgrade';
import { openDb, runMigrations, sqliteOf } from './index';
import * as schema from './schema';

const LEGACY = './src/lib/server/db/fixtures/legacy-chain';
let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'tmt-baseline-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tablesOf = (c: Database.Database) =>
	(
		c
			.prepare(
				`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name`
			)
			.all() as { name: string }[]
	).map((t) => t.name);

/** Insert two rows into every table (parents first); nullable cyclic references stay NULL. */
function seedEveryTable(c: Database.Database) {
	c.pragma('foreign_keys = ON');
	const names = tablesOf(c);
	const fks = (t: string) =>
		c.pragma(`foreign_key_list("${t}")`) as { from: string; table: string; to: string }[];
	const done = new Set<string>();
	const first = new Map<string, Record<string, unknown>[]>();
	let guard = 0;
	while (done.size < names.length && guard++ < 100) {
		for (const t of names) {
			if (done.has(t)) continue;
			const f = fks(t).filter((x) => x.table !== t);
			if (!f.every((x) => done.has(x.table))) continue;
			const cols = c.pragma(`table_info("${t}")`) as {
				name: string;
				type: string;
				notnull: number;
			}[];
			const rows: Record<string, unknown>[] = [];
			for (let i = 0; i < 2; i++) {
				const row: Record<string, unknown> = {};
				for (const col of cols) {
					const fk = fks(t).find((x) => x.from === col.name);
					if (fk) {
						if (fk.table === t) {
							if (col.notnull) throw new Error(`self reference ${t}.${col.name} is required`);
							row[col.name] = null;
						} else {
							// Row 0 of table with an owner org points at org 0, row 1 stays unowned.
							const parent = first.get(fk.table)!;
							row[col.name] =
								t === 'templates' && col.name === 'owner_org_id' && i === 1
									? null
									: parent[i % parent.length][fk.to];
						}
					} else if (/int|real|num/i.test(col.type)) row[col.name] = 1700000000000 + i;
					else row[col.name] = `${t}-${col.name}-${i}`;
				}
				rows.push(row);
			}
			const names2 = Object.keys(rows[0]);
			const ins = c.prepare(
				`INSERT INTO "${t}" (${names2.map((n) => `"${n}"`).join(',')}) VALUES (${names2.map(() => '?').join(',')})`
			);
			for (const r of rows) ins.run(...names2.map((n) => r[n]));
			first.set(t, rows);
			done.add(t);
		}
	}
	expect([...done].sort()).toEqual(names);
}

function contentHashes(c: Database.Database) {
	const out: Record<string, { n: number; hash: string }> = {};
	for (const t of tablesOf(c)) {
		const cols = (c.pragma(`table_info("${t}")`) as { name: string }[]).map((x) => x.name).sort();
		const sel = cols.map((x) => `"${x}"`).join(',');
		const rows = c.prepare(`SELECT ${sel} FROM "${t}" ORDER BY ${sel}`).all();
		out[t] = {
			n: rows.length,
			hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex')
		};
	}
	return out;
}

function schemaFingerprint(c: Database.Database) {
	const master = c
		.prepare(
			`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY type, name`
		)
		.all() as { type: string; name: string; tbl_name: string; sql: string }[];
	const perTable: Record<string, unknown> = {};
	for (const t of tablesOf(c)) {
		const q = `"${t}"`;
		perTable[t] = {
			info: c.pragma(`table_info(${q})`),
			fk: c.pragma(`foreign_key_list(${q})`),
			idx: (c.pragma(`index_list(${q})`) as { name: string; origin: string }[])
				// `seq` is creation order, which legitimately differs after a table rebuild
				.map(({ name, origin, ...rest }) => ({
					name,
					origin,
					unique: (rest as { unique: number }).unique,
					partial: (rest as { partial: number }).partial,
					cols: c.pragma(`index_info("${name}")`)
				}))
				.sort((a, b) => a.name.localeCompare(b.name))
		};
	}
	return { master: master.map((m) => ({ ...m, sql: normalizeWs(m.sql) })), perTable };
}

const journal = (c: Database.Database) =>
	c.prepare(`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at`).all();

function legacyDb(file: string) {
	const c = new Database(file);
	c.pragma('journal_mode = WAL'); // as in production (openDb)
	migrate(drizzle(c), { migrationsFolder: LEGACY });
	seedEveryTable(c);
	c.close();
}

describe('baseline migration and upgrade from the retired 14-migration chain', () => {
	it('the vendored old chain is the one the upgrade expects', () => {
		const c = new Database(':memory:');
		migrate(drizzle(c), { migrationsFolder: LEGACY });
		expect(journal(c)).toHaveLength(14);
		expect(journal(c).map((r) => [(r as { hash: string }).hash])).toEqual(
			LEGACY_CHAIN.map((l) => [l[1]])
		);
	});

	it('fresh install has exactly the declared schema, with the cascade on templates.owner_org_id', () => {
		const db = openDb(':memory:');
		runMigrations(db);
		const c = sqliteOf(db);
		expect(journal(c)).toHaveLength(1);
		const fk = c.pragma('foreign_key_list("templates")') as { from: string; on_delete: string }[];
		expect(fk.find((f) => f.from === 'owner_org_id')?.on_delete).toBe('CASCADE');
		// Exactly the tables schema.ts declares.
		const declared = Object.values(schema)
			.filter((v) => is(v, SQLiteTable))
			.map((t) => getTableName(t as SQLiteTable))
			.sort();
		expect(tablesOf(c)).toEqual(declared);
	});

	it('upgrades an old-chain database: data intact, schema and journal identical to a fresh install, idempotent', () => {
		const file = join(dir, 'old.db');
		legacyDb(file);
		const before = new Database(file);
		const hashBefore = contentHashes(before);
		before.close();
		// every table has rows, including the relation under repair
		for (const [t, v] of Object.entries(hashBefore)) expect(v.n, t).toBeGreaterThan(0);

		const db = openDb(file);
		runMigrations(db);
		const c = sqliteOf(db);
		const fresh = openDb(':memory:');
		runMigrations(fresh);
		const f = sqliteOf(fresh);

		expect(contentHashes(c)).toEqual(hashBefore);
		expect(schemaFingerprint(c)).toEqual(schemaFingerprint(f));
		// Stored schema text identical to a fresh install (whitespace-normalized only, quotes included).
		const dump = (k: Database.Database) =>
			(
				k.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name`).all() as {
					sql: string | null;
				}[]
			).map((r) => ({ ...r, sql: normalizeWs(r.sql) }));
		expect(dump(c)).toEqual(dump(f));
		expect(journal(c)).toEqual(journal(f));
		expect(journal(c)).toHaveLength(1);
		expect(c.pragma('foreign_key_check')).toEqual([]);
		expect(c.pragma('integrity_check', { simple: true })).toBe('ok');
		expect(c.pragma('foreign_keys', { simple: true })).toBe(1);

		c.close();

		// Second start: byte-identical file contents (WAL checkpointed on close).
		const again = openDb(file);
		const sum = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
		sqliteOf(again).close();
		const s1 = sum(file);
		const third = openDb(file);
		runMigrations(third);
		runMigrations(third);
		sqliteOf(third).close();
		expect(sum(file)).toBe(s1);
	});

	it('organization delete cascades to its (otherwise unreferenced) templates after the upgrade; the old schema refused it', () => {
		const add = (c: Database.Database) => {
			c.pragma('foreign_keys = ON');
			const org = c.prepare(`SELECT * FROM organization LIMIT 1`).get() as Record<string, unknown>;
			const cols = Object.keys(org);
			c.prepare(
				`INSERT INTO organization (${cols.map((x) => `"${x}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`
			).run(...cols.map((k) => (typeof org[k] === 'string' ? `x-${org[k]}` : org[k])));
			const tpl = c.prepare(`SELECT * FROM templates LIMIT 1`).get() as Record<string, unknown>;
			const t = {
				...tpl,
				id: 'tpl-x',
				slug: 'tpl-x',
				owner_org_id: `x-${(org as { id: string }).id}`
			};
			const tc = Object.keys(t);
			c.prepare(
				`INSERT INTO templates (${tc.map((x) => `"${x}"`).join(',')}) VALUES (${tc.map(() => '?').join(',')})`
			).run(...tc.map((k) => (t as Record<string, unknown>)[k]));
			return t.owner_org_id as string;
		};
		const old = join(dir, 'cascade-old.db');
		legacyDb(old);
		const o = new Database(old);
		const orgOld = add(o);
		expect(() => o.prepare(`DELETE FROM organization WHERE id = ?`).run(orgOld)).toThrow(
			/FOREIGN KEY/
		);
		o.close();
		const db = openDb(old);
		runMigrations(db);
		const c = sqliteOf(db);
		c.prepare(`DELETE FROM organization WHERE id = ?`).run(orgOld);
		expect(c.prepare(`SELECT 1 FROM templates WHERE id = 'tpl-x'`).get()).toBeUndefined();
		c.close();
	});

	describe('refuses, leaving the file byte-identical', () => {
		const sum = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
		function refuse(name: string, tamper: (c: Database.Database) => void, msg: RegExp) {
			it(name, () => {
				const file = join(dir, `${name.replace(/\W+/g, '-')}.db`);
				legacyDb(file);
				const c = new Database(file);
				tamper(c);
				c.pragma('wal_checkpoint(TRUNCATE)');
				c.close();
				const copy = file + '.copy';
				copyFileSync(file, copy);
				const db = openDb(file);
				expect(() => runMigrations(db)).toThrow(msg);
				sqliteOf(db).close();
				// opening in WAL mode may touch -wal/-shm only; the main file must not change
				expect(sum(file)).toBe(sum(copy));
			});
		}
		refuse(
			'old chain incomplete (0013 missing)',
			(c) => c.exec(`DELETE FROM __drizzle_migrations WHERE created_at = ${LEGACY_CHAIN[13][2]}`),
			/incomplete or modified/
		);
		refuse(
			'unknown hash',
			(c) =>
				c.exec(
					`UPDATE __drizzle_migrations SET hash = 'deadbeef' WHERE created_at = ${LEGACY_CHAIN[5][2]}`
				),
			/incomplete or modified/
		);
		refuse(
			'only unknown rows',
			(c) =>
				c.exec(
					`DELETE FROM __drizzle_migrations; INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('x', 1)`
				),
			/unknown entries/
		);
		refuse(
			'extra row after 0013',
			(c) =>
				c.exec(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('x', 9999999999999)`),
			/incomplete or modified/
		);
		refuse(
			'schema drifted from the old chain (extra column)',
			(c) => c.exec(`ALTER TABLE printers ADD COLUMN surprise text`),
			/baseline does not/
		);
		refuse(
			'schema drifted (missing table)',
			(c) => c.exec(`PRAGMA foreign_keys=OFF; DROP TABLE site_admin`),
			/site_admin is missing/
		);
		refuse(
			'schema drifted (extra index)',
			(c) => c.exec(`CREATE INDEX surprise_idx ON site_admin (user_id)`),
			/surprise_idx/
		);
	});
});
