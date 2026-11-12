/**
 * Release upgrade guard. Every folder under `fixtures/v*` is a frozen database of a released
 * version (its schema exactly as a fresh install of that release has it, plus invented data).
 * For each one this test rebuilds that database, runs the app's real `runMigrations` on it and
 * checks that nothing was lost, the schema equals a fresh install's, and the post-migration
 * startup steps leave the data alone.
 *
 * Rules this test enforces from 0.9.0 on:
 * - Never edit or squash a released migration (see the baseline guard below): add a new one.
 * - Fixtures are frozen: never regenerate or edit `fixtures/v<release>/` after the release is
 *   tagged. At each release add a new `fixtures/v<next>/` folder (schema.sql, data.sql, meta.json).
 * - A migration that fails on, or loses, a released install's data fails here, in CI.
 *
 * Needs no kit pack, no network and no Docker. `TMT_UPGRADE_TEST_DRIZZLE_DIR` points the test at
 * another migrations folder; it exists only to prove the test fails on a bad migration
 * (copy `drizzle/` elsewhere, add a destructive migration, run this file with the variable set).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeWs } from './baseline-upgrade';
import { MIGRATIONS_FOLDER, openDb, runMigrations, sqliteOf, type Db } from './index';
import { cleanupAuthDataAtStartup } from '../auth-cleanup';
import { backfillBuildParts } from '../builds/backfill';
import { repairTwinPlates } from '../builds/twin-repair';
import { failStaleModelJobs } from '../models/jobs';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';

const FIXTURES = resolve(fileURLToPath(new URL('./fixtures', import.meta.url)));
const MIGRATIONS = process.env.TMT_UPGRADE_TEST_DRIZZLE_DIR ?? MIGRATIONS_FOLDER;
const NEVER_EDIT = 'Never edit or squash released migrations: add a new one.';

interface Meta {
	version: string;
	journal: { tag: string; hash: string; when: number }[];
	counts: Record<string, number>;
	spot: { table: string; pk: Record<string, unknown>; values: Record<string, unknown> }[];
}
type Row = Record<string, unknown>;
type Snapshot = Record<string, Row[]>;

const versions = readdirSync(FIXTURES)
	.filter((d) => /^v\d/.test(d) && existsSync(join(FIXTURES, d, 'meta.json')))
	.sort();
const read = (v: string, f: string) => readFileSync(join(FIXTURES, v, f), 'utf8');
const metaOf = (v: string) => JSON.parse(read(v, 'meta.json')) as Meta;

let tmp: string;
beforeAll(() => {
	tmp = mkdtempSync(join(tmpdir(), 'tmt-upgrade-'));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const userTables = (c: ReturnType<typeof sqliteOf>) =>
	(
		c
			.prepare(
				`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name`
			)
			.all() as { name: string }[]
	).map((t) => t.name);

/** Schema as a comparable list: whitespace-normalised, stable order, no sqlite internals. */
function schemaOf(c: ReturnType<typeof sqliteOf>): string[] {
	return (
		c
			.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'`)
			.all() as { type: string; name: string; tbl_name: string; sql: string | null }[]
	)
		.map((r) => `${r.type} ${r.name} on ${r.tbl_name}: ${normalizeWs(r.sql)}`)
		.sort();
}

const journalOf = (c: ReturnType<typeof sqliteOf>) =>
	c.prepare(`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at`).all() as {
		hash: string;
		created_at: number;
	}[];

function snapshot(c: ReturnType<typeof sqliteOf>): Snapshot {
	const out: Snapshot = {};
	for (const t of userTables(c)) out[t] = sorted(c.prepare(`SELECT * FROM ${q(t)}`).all() as Row[]);
	return out;
}

const sorted = (rows: Row[]) =>
	rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

function pkColumns(c: ReturnType<typeof sqliteOf>, table: string): string[] {
	return (c.pragma(`table_info(${q(table)})`) as { name: string; pk: number }[])
		.filter((col) => col.pk > 0)
		.sort((a, b) => a.pk - b.pk)
		.map((col) => col.name);
}

/** Creates the released database: its frozen schema and journal rows, then its data. */
function buildReleasedDb(v: string): Db {
	const db = openDb(join(tmp, `released-${v}-${Math.random().toString(36).slice(2)}.db`));
	const c = sqliteOf(db);
	c.exec(read(v, 'schema.sql'));
	c.exec(read(v, 'data.sql'));
	return db;
}

function freshDb(): Db {
	const db = openDb(join(tmp, `fresh-${Math.random().toString(36).slice(2)}.db`));
	runMigrations(db, MIGRATIONS);
	return db;
}

describe('released migrations are frozen', () => {
	for (const v of versions) {
		it(`${v}: the migrations a ${v} install has applied are unchanged`, () => {
			const { journal } = metaOf(v);
			const journalFile = JSON.parse(
				readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')
			) as {
				entries: { tag: string; when: number }[];
			};
			const problems: string[] = [];
			journal.forEach((frozen, i) => {
				const entry = journalFile.entries[i];
				if (!entry || entry.tag !== frozen.tag) {
					problems.push(
						`journal entry ${i}: expected "${frozen.tag}", found ${entry ? `"${entry.tag}"` : 'nothing'}`
					);
					return;
				}
				if (entry.when !== frozen.when)
					problems.push(
						`${frozen.tag}: journal "when" changed from ${frozen.when} to ${entry.when}`
					);
				const file = join(MIGRATIONS, `${frozen.tag}.sql`);
				const hash = existsSync(file)
					? createHash('sha256').update(readFileSync(file, 'utf8')).digest('hex')
					: 'missing file';
				if (hash !== frozen.hash)
					problems.push(
						`${frozen.tag}.sql changed: sha256 is ${hash}, a ${v} install recorded ${frozen.hash}`
					);
			});
			expect(problems, `${NEVER_EDIT}\n${problems.join('\n')}`).toEqual([]);
		});
	}
});

describe.each(versions)('upgrade from release %s', (v) => {
	const meta = metaOf(v);
	let released: Db;
	let before: Snapshot;
	let beforeSchema: string[];
	let fresh: Db;

	beforeAll(() => {
		released = buildReleasedDb(v);
		fresh = freshDb();
		before = snapshot(sqliteOf(released));
		beforeSchema = schemaOf(sqliteOf(released));
	});

	it('the fixture itself is consistent (counts, foreign keys, frozen schema)', () => {
		const counts = Object.fromEntries(Object.entries(before).map(([t, rows]) => [t, rows.length]));
		expect(counts).toEqual(meta.counts);
		expect(sqliteOf(released).pragma('foreign_key_check')).toEqual([]);
		expect(journalOf(sqliteOf(released))).toEqual(
			meta.journal.map((j) => ({ hash: j.hash, created_at: j.when }))
		);
	});

	it('migrates without throwing and ends with the same schema as a fresh install', () => {
		expect(() => runMigrations(released, MIGRATIONS)).not.toThrow();
		const c = sqliteOf(released);
		expect(c.pragma('foreign_key_check')).toEqual([]);
		expect(c.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
		const got = schemaOf(c);
		const want = schemaOf(sqliteOf(fresh));
		expect(
			got.filter((l) => !want.includes(l)),
			`schema of the upgraded ${v} database differs from a fresh install (these lines are only in the upgraded one)`
		).toEqual([]);
		expect(
			want.filter((l) => !got.includes(l)),
			`schema of the upgraded ${v} database differs from a fresh install (these lines are only in the fresh one)`
		).toEqual([]);
		expect(beforeSchema.length).toBeGreaterThan(0);
		// The journal keeps the released rows and ends where a fresh install does.
		expect(journalOf(c).slice(0, meta.journal.length)).toEqual(
			meta.journal.map((j) => ({ hash: j.hash, created_at: j.when }))
		);
		expect(journalOf(c)).toEqual(journalOf(sqliteOf(fresh)));
	});

	it('keeps every row the release had', () => {
		const c = sqliteOf(released);
		const problems: string[] = [];
		for (const [table, rows] of Object.entries(before)) {
			const cols = (c.pragma(`table_info(${q(table)})`) as { name: string }[]).map((x) => x.name);
			if (!cols.length) {
				problems.push(`table ${table} no longer exists (it held ${rows.length} row(s))`);
				continue;
			}
			const oldCols = Object.keys(rows[0] ?? {});
			const gone = oldCols.filter((col) => !cols.includes(col));
			if (gone.length) problems.push(`${table}: column(s) ${gone.join(', ')} no longer exist`);
			const n = (c.prepare(`SELECT count(*) AS n FROM ${q(table)}`).get() as { n: number }).n;
			if (n < rows.length) problems.push(`${table}: ${rows.length} row(s) before, ${n} after`);
			const pk = pkColumns(c, table);
			if (pk.length && !gone.some((g) => pk.includes(g))) {
				const have = new Set(
					(c.prepare(`SELECT ${pk.map(q).join(', ')} FROM ${q(table)}`).all() as Row[]).map((r) =>
						JSON.stringify(pk.map((k) => r[k]))
					)
				);
				for (const r of rows)
					if (!have.has(JSON.stringify(pk.map((k) => r[k]))))
						problems.push(`${table}: row ${JSON.stringify(pk.map((k) => r[k]))} is gone`);
			}
		}
		for (const s of meta.spot) {
			const where = Object.keys(s.pk);
			const row = c
				.prepare(
					`SELECT * FROM ${q(s.table)} WHERE ${where.map((k) => `${q(k)} = ?`).join(' AND ')}`
				)
				.get(...Object.values(s.pk)) as Row | undefined;
			const label = `${s.table} ${JSON.stringify(s.pk)}`;
			if (!row) continue; // reported above as a missing row
			for (const [col, want] of Object.entries(s.values)) {
				if (!(col in row)) problems.push(`${label}: column ${col} no longer exists`);
				else if (row[col] !== want)
					problems.push(
						`${label}: ${col} was ${JSON.stringify(want)}, is now ${JSON.stringify(row[col])}`
					);
			}
		}
		expect(
			problems,
			`A migration lost or changed data of a ${v} install:\n${problems.join('\n')}`
		).toEqual([]);
	});

	it('running the migrations again changes nothing', () => {
		const c = sqliteOf(released);
		const schema = schemaOf(c);
		const journal = journalOf(c);
		const data = snapshot(c);
		expect(() => runMigrations(released, MIGRATIONS)).not.toThrow();
		expect(schemaOf(c)).toEqual(schema);
		expect(journalOf(c)).toEqual(journal);
		expect(snapshot(c)).toEqual(data);
	});

	it('the startup steps after migrations leave the release data alone', () => {
		const c = sqliteOf(released);
		const pre = snapshot(c);
		const fixtureTemplates = (pre.templates ?? []).map((t) => t.id as string);
		const fixtureBuilds = (pre.builds ?? []).map((b) => b.id as string);

		// Same order as startup(); the steps that need the kit pack, the network, the data
		// directory or printers (installKitPacks, sweepImportsDir, kickQueue, supervisor) are not run.
		cleanupAuthDataAtStartup(released);
		const seeded = seedTemplates(released, templateSeeds);
		expect(seeded.inserted.length + seeded.updated.length).toBeGreaterThan(0);
		expect(backfillBuildParts(released)).toBe(0);
		expect(repairTwinPlates(released)).toEqual([]);
		expect(failStaleModelJobs(released)).toBe(0);
		expect(c.pragma('foreign_key_check')).toEqual([]);

		const post = snapshot(c);
		const expected = structuredClone(pre);
		// The one intended change: the auth cleanup (IPs and sign-in tokens are not kept). It also
		// bumps `updated_at` on the rows it touches (drizzle's $onUpdate), which is allowed.
		const touched = (t: string, id: unknown, was: Row, now: Row) => {
			if (JSON.stringify(was) !== JSON.stringify(now)) {
				const live = post[t].find((r) => r.id === id);
				if (live) now.updated_at = live.updated_at;
			}
		};
		for (const s of expected.session ?? []) {
			const was = { ...s };
			if (s.ip_address) s.ip_address = '';
			touched('session', s.id, was, s);
		}
		for (const a of expected.account ?? []) {
			const was = { ...a };
			a.access_token = null;
			a.refresh_token = null;
			a.access_token_expires_at = null;
			a.refresh_token_expires_at = null;
			if (a.provider_id !== 'oidc') a.id_token = null;
			touched('account', a.id, was, a);
		}
		for (const t of ['session', 'account']) sorted(expected[t]);
		const problems: string[] = [];
		for (const [table, rows] of Object.entries(expected)) {
			// Built-in template data may be upserted; only the fixture's own template rows are compared.
			const cols = Object.keys(rows[0] ?? {});
			const isTemplateData = table === 'templates' || cols.includes('template_id');
			const keep = (r: Row) =>
				table === 'templates'
					? fixtureTemplates.includes(r.id as string)
					: cols.includes('template_id')
						? fixtureTemplates.includes(r.template_id as string)
						: true;
			const want = isTemplateData ? rows.filter(keep) : rows;
			const got = isTemplateData ? (post[table] ?? []).filter(keep) : (post[table] ?? []);
			if (JSON.stringify(got) !== JSON.stringify(want))
				problems.push(
					`${table}: rows changed by a startup step\n  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`
				);
		}
		expect(
			problems,
			`A startup step altered a ${v} install's user data:\n${problems.join('\n')}`
		).toEqual([]);
		expect(fixtureBuilds.length).toBeGreaterThan(0);

		// The cleanup did what it is meant to, and kept the rest of the account.
		const acc = c.prepare(`SELECT * FROM account WHERE id = 'acc-viewer'`).get() as Row;
		expect(acc.access_token).toBeNull();
		expect(acc.id_token).toBe('demo-id-token');
		expect(acc.scope).toBe('openid email');

		// A second pass is a no-op.
		cleanupAuthDataAtStartup(released);
		expect(seedTemplates(released, templateSeeds)).toEqual({ inserted: [], updated: [] });
		expect(backfillBuildParts(released)).toBe(0);
		expect(snapshot(c)).toEqual(post);
	});
});

it('there is at least one release fixture', () => {
	expect(versions.length).toBeGreaterThan(0);
});
