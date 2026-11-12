/**
 * One-time bridge from the pre-release migration chain (0000_init .. 0013_tiresome_timeslip, 14
 * journal rows) to the single baseline migration that replaced it before the first public release.
 *
 * How drizzle's better-sqlite3 migrator decides what to run (drizzle-orm 0.45.4):
 * - `migrator.js` readMigrationFiles: per journal entry, `hash` = sha256 of the .sql text and
 *   `folderMillis` = the journal entry's `when`.
 * - `sqlite-core/dialect.js:653-656` reads ONLY the newest row of `__drizzle_migrations`
 *   (`ORDER BY created_at DESC LIMIT 1`); line 660 runs a migration only when that row's
 *   `created_at` is `<` the migration's `folderMillis`. The stored hash is never compared.
 *
 * So an old database (newest created_at = 0013's `when`) would run the new baseline (a later
 * `when`) on top of existing tables and fail. This module runs before `migrate()`: when the
 * journal is exactly the known old chain, it makes the schema identical to the baseline
 * (rebuilding the tables whose definitions differ, which also adds the ON DELETE CASCADE on
 * `templates.owner_org_id` that migration 0007 never created) and replaces the 14 journal rows with
 * the one baseline row (same hash and `when` a fresh install records). `migrate()` then sees
 * nothing to do. Anything else unexpected throws and leaves the file untouched.
 */
import { readMigrationFiles } from 'drizzle-orm/migrator';
import Database from 'better-sqlite3';
import { sqliteOf, type Db } from './index';

/** [tag, sha256 of the .sql text, journal `when`] of the retired chain. */
export const LEGACY_CHAIN: ReadonlyArray<readonly [string, string, number]> = [
	['0000_init', 'd99a2d3d4158046392bead6d51a0515eaf95eaa90f0652d525748fe1b35ab46a', 1793647171170],
	[
		'0001_next_sauron',
		'8693ac6fe320e5d6bf9ee982ed1e2442077ff97c9f9713be3928c6033bf6d95f',
		1793653264844
	],
	[
		'0002_rich_domino',
		'2e026bc668a73e326d285515984850cd7b720830b4a0af301765aa5e6d995245',
		1793688861231
	],
	[
		'0003_variants_placements',
		'0ee528c3ffac4b158bf0cf6e9431e41dfca2aa52ddedaf7ca60c283637e38cab',
		1793716309726
	],
	[
		'0004_step2_models_layouts_uploads',
		'acca8a70744c3782793f293ab4db99099be0b38a13db82c95ed6cc1982e83a9f',
		1793717640252
	],
	[
		'0005_woozy_boomer',
		'1e21dc22e8b16799396cd97b679fc2da122388a6669fc57cc02fe399323f06d2',
		1793722645620
	],
	[
		'0006_m6_m7_assembly_printers',
		'f81e3f61a2a7966bb52acc5a170337d6f75113c93f13b0d51e31792b72d973da',
		1793757865352
	],
	[
		'0007_information_architecture',
		'0d77dc7e96b66704802f24fefd3b6f13b20f1df4403c296f02924f4c0671cec4',
		1793772850620
	],
	[
		'0008_custom_filaments',
		'0010e69ba3756469efb813924258737fe125ba4ff0d7926b2cefb8ff33e37d73',
		1793819735979
	],
	[
		'0009_build_part_profiles',
		'2acfc83c439b377bd92f34e41be1a9be978194edb6f3f7e204f15fd88c2954fb',
		1793997456151
	],
	[
		'0010_build_kind_draft',
		'4cd62ac52d9aaca2b187bb52701d10c912943a9fb049841f30774c6aeaecb48f',
		1794024474628
	],
	[
		'0011_printer_camera',
		'9f0db6c7933d4e1b193a601ae0197d921bb621c5f3b161e68b69a742d2cd2a5f',
		1794095035314
	],
	[
		'0012_plate_manual_time',
		'42e3fbf5333e61a421d796c6881a59672fa0ae19f67a291fea83ab7b27174da9',
		1794242263387
	],
	[
		'0013_tiresome_timeslip',
		'5d80bf8bf5ec9e976fd5fc6b85ab8af3047abf9779d25accba1cecba676db80b',
		1794407444445
	]
];

const MIGRATIONS_TABLE = '__drizzle_migrations';

type Row = { type: string; name: string; tbl_name: string; sql: string | null };

/** Whitespace-only normalization: the stored text must match the baseline's exactly otherwise. */
export function normalizeWs(s: string | null): string {
	return (s ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Also ignores identifier quoting (an old ALTER ... RENAME leaves "x" where a fresh install has
 * `x`). Used to decide whether the old database is the expected old chain; never to skip a rebuild.
 */
export function normalizeSql(s: string | null): string {
	return normalizeWs(s).replace(/["`]/g, '');
}

function schemaRows(c: Database.Database): Map<string, Row> {
	const rows = c
		.prepare(
			`SELECT type, name, tbl_name, sql FROM sqlite_master
			 WHERE name NOT LIKE 'sqlite_%' AND name != ? ORDER BY type, name`
		)
		.all(MIGRATIONS_TABLE) as Row[];
	return new Map(rows.map((r) => [`${r.type}:${r.name}`, r]));
}

function quoteId(n: string): string {
	return '"' + n.replace(/"/g, '""') + '"';
}

function fail(why: string): never {
	throw new Error(
		`[tmt] Refusing to start: the database cannot be upgraded safely (${why}). The database file ` +
			`was not changed. Restore a backup or ask for help; do not delete the migrations table by hand.`
	);
}

type JournalRow = { hash: string; created_at: number | string | null };

/**
 * Upgrades a database that sits at the end of the retired 14-migration chain. No-op for fresh
 * databases and databases already on the baseline chain. Throws, changing nothing, otherwise.
 */
export function upgradeLegacyChain(db: Db, folder: string): void {
	const c = sqliteOf(db);
	const exists = c
		.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
		.get(MIGRATIONS_TABLE);
	if (!exists) return;
	const read = () =>
		c
			.prepare(`SELECT hash, created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at, rowid`)
			.all() as JournalRow[];
	const rows = read();
	if (!rows.length) return;

	const migrations = readMigrationFiles({ migrationsFolder: folder });
	const baseline = migrations[0];
	if (!baseline) fail('the migrations folder is empty');
	// Already on the new chain (any length): the stock migrator handles it.
	if (rows[0].hash === baseline.hash && Number(rows[0].created_at) === baseline.folderMillis)
		return;

	const isLegacy =
		rows.length === LEGACY_CHAIN.length &&
		rows.every(
			(r, i) => r.hash === LEGACY_CHAIN[i][1] && Number(r.created_at) === LEGACY_CHAIN[i][2]
		);
	if (!isLegacy) {
		const known = new Set(LEGACY_CHAIN.map((l) => l[1]));
		const nLegacy = rows.filter((r) => known.has(r.hash)).length;
		fail(
			nLegacy
				? `the old migration history is incomplete or modified (${nLegacy} of ${LEGACY_CHAIN.length} known entries among ${rows.length} rows)`
				: `the migration history contains unknown entries (${rows.length} rows)`
		);
	}

	// Reference schema: the baseline SQL executed on a scratch in-memory database.
	const ref = new Database(':memory:');
	let want: Map<string, Row>;
	try {
		for (const stmt of baseline.sql) if (stmt.trim()) ref.exec(stmt);
		want = schemaRows(ref);
	} finally {
		ref.close();
	}

	// Table rebuilds need foreign keys off, and that pragma is a no-op inside a transaction.
	const fkWas = c.pragma('foreign_keys', { simple: true });
	c.pragma('foreign_keys = OFF');
	try {
		c.exec('BEGIN IMMEDIATE');
		try {
			// Re-check under the write lock (another process may have upgraded meanwhile).
			const again = read();
			if (again.length !== rows.length || again.some((r, i) => r.hash !== rows[i].hash))
				fail('the migration history changed while upgrading');

			const fkBefore = JSON.stringify(c.pragma('foreign_key_check'));
			const have = schemaRows(c);
			const tables = [...want.values()].filter((r) => r.type === 'table');
			const rebuilt = new Set<string>();
			for (const t of tables) {
				const cur = have.get(`table:${t.name}`);
				if (!cur) fail(`table ${t.name} is missing`);
				if (normalizeWs(cur.sql) === normalizeWs(t.sql)) continue;
				rebuild(c, t);
				rebuilt.add(t.name);
			}
			// Dropping a table dropped its indexes and triggers; others whose stored text differs
			// (quote style) are replaced too. All are recreated from the baseline text.
			for (const r of want.values()) {
				if (r.type === 'table') continue;
				const cur = have.get(`${r.type}:${r.name}`);
				if (rebuilt.has(r.tbl_name) || (cur && normalizeWs(cur.sql) !== normalizeWs(r.sql))) {
					c.exec(`DROP ${r.type.toUpperCase()} IF EXISTS ${quoteId(r.name)}`);
					c.exec(r.sql as string);
				}
			}

			// The whole schema must now equal the baseline's, or nothing is committed.
			const after = schemaRows(c);
			const problems: string[] = [];
			for (const k of new Set([...after.keys(), ...want.keys()])) {
				if (normalizeSql(after.get(k)?.sql ?? null) !== normalizeSql(want.get(k)?.sql ?? null))
					problems.push(k);
			}
			if (problems.length) fail(`schema differs from the baseline in: ${problems.join(', ')}`);
			// Exact (whitespace-only) equality of every stored definition, so the upgraded file is
			// indistinguishable from a fresh install.
			const inexact = [...want.keys()].filter(
				(k) => normalizeWs(after.get(k)?.sql ?? null) !== normalizeWs(want.get(k)?.sql ?? null)
			);
			if (inexact.length) fail(`stored SQL differs from the baseline in: ${inexact.join(', ')}`);
			if (JSON.stringify(c.pragma('foreign_key_check')) !== fkBefore)
				fail('foreign key violations appeared during the upgrade');
			const integrity = c.pragma('integrity_check', { simple: true });
			if (integrity !== 'ok') fail(`integrity_check: ${String(integrity)}`);

			c.prepare(`DELETE FROM ${MIGRATIONS_TABLE}`).run();
			c.prepare(`INSERT INTO ${MIGRATIONS_TABLE} ("hash", "created_at") VALUES (?, ?)`).run(
				baseline.hash,
				baseline.folderMillis
			);
			c.exec('COMMIT');
			console.log(
				`[tmt] database upgraded to the baseline migration (rebuilt: ${[...rebuilt].join(', ') || 'none'})`
			);
		} catch (e) {
			if (c.inTransaction) c.exec('ROLLBACK');
			throw e;
		}
	} finally {
		if (fkWas) c.pragma('foreign_keys = ON');
	}
}

/** Copy rows aside, recreate the table from the baseline DDL under its own name, copy back. */
function rebuild(c: Database.Database, want: Row): void {
	const name = want.name;
	const oldCols = (c.pragma(`table_info(${quoteId(name)})`) as { name: string }[]).map(
		(x) => x.name
	);
	const newCols = new Set<string>();
	// Column list of the new definition, read from a scratch table so we do not parse SQL.
	const scratch = new Database(':memory:');
	try {
		scratch.exec(want.sql as string);
		for (const x of scratch.pragma(`table_info(${quoteId(name)})`) as { name: string }[])
			newCols.add(x.name);
	} finally {
		scratch.close();
	}
	const lost = oldCols.filter((x) => !newCols.has(x));
	if (lost.length) fail(`table ${name} has columns the baseline does not: ${lost.join(', ')}`);
	const common = oldCols.map(quoteId).join(', ');
	const tmp = quoteId(`__legacy_${name}`);
	c.exec(`CREATE TABLE ${tmp} AS SELECT ${common} FROM ${quoteId(name)}`);
	c.exec(`DROP TABLE ${quoteId(name)}`);
	c.exec(want.sql as string);
	c.exec(`INSERT INTO ${quoteId(name)} (${common}) SELECT ${common} FROM ${tmp}`);
	c.exec(`DROP TABLE ${tmp}`);
}
