import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, openDb, runMigrations, sqliteOf } from './index';

const tmp = mkdtempSync(join(tmpdir(), 'tmt-runs-created-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A migrations folder holding only 0000-0002 (what a released install has applied). */
function folderBefore0003() {
	const dir = join(tmp, 'before');
	mkdirSync(join(dir, 'meta'), { recursive: true });
	const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'));
	journal.entries = journal.entries.slice(0, 3);
	writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(journal));
	for (const e of journal.entries)
		cpSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
	return dir;
}

describe('0003 back-fills print_runs.created_at', () => {
	it('uses the run.add activity time, else the start of the run date (UTC), and is stable', () => {
		const db = openDb(join(tmp, 'a.db'));
		runMigrations(db, folderBefore0003());
		const c = sqliteOf(db);
		c.pragma('foreign_keys = OFF');
		const run = c.prepare(
			`INSERT INTO print_runs (id, build_id, date, result, note) VALUES (?, 'b1', ?, 'Success', '')`
		);
		const act = c.prepare(
			`INSERT INTO activity (id, build_id, kind, payload, at) VALUES (?, 'b1', ?, ?, ?)`
		);
		run.run('r-single', '2026-03-05');
		run.run('r-partial-a', '2026-03-06');
		run.run('r-partial-b', '2026-03-06');
		run.run('r-none', '2026-03-07');
		run.run('r-baddate', 'not a date');
		run.run('r-wrong-kind', '2026-03-08');
		act.run('a1', 'run.add', JSON.stringify({ runId: 'r-single' }), 1_000_111);
		act.run(
			'a2',
			'run.add',
			JSON.stringify({ runId: 'r-partial-a', runIds: ['r-partial-a', 'r-partial-b'] }),
			2_000_222
		);
		act.run('a3', 'run.edit', JSON.stringify({ runId: 'r-wrong-kind' }), 3_000_333);
		act.run('a4', 'run.add', 'not json', 4_000_444);

		runMigrations(db); // applies 0003 on top
		const got = Object.fromEntries(
			(
				c.prepare('SELECT id, created_at FROM print_runs').all() as {
					id: string;
					created_at: number | null;
				}[]
			).map((r) => [r.id, r.created_at])
		);
		expect(got).toEqual({
			'r-single': 1_000_111,
			'r-partial-a': 2_000_222,
			'r-partial-b': 2_000_222,
			'r-none': Date.UTC(2026, 2, 7),
			'r-baddate': null,
			'r-wrong-kind': Date.UTC(2026, 2, 8)
		});

		const dump = () => c.prepare('SELECT id, created_at FROM print_runs ORDER BY id').all();
		const before = dump();
		runMigrations(db); // second start changes nothing
		expect(dump()).toEqual(before);
		c.close();
	});
});
