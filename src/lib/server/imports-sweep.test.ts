import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, runMigrations, type Db } from './db';
import { templateModelJobs, templates } from './db/schema';
import { templateSeeds } from './seed';
import { seedTemplates } from './seed/run';
import { sweepImportsDir } from './imports-sweep';

let db: Db;
let dir: string;
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

function age(p: string, hours: number) {
	const t = (Date.now() - hours * 3600_000) / 1000;
	utimesSync(p, t, t);
}
function file(name: string, hours: number) {
	const p = join(dir, name);
	writeFileSync(p, 'x');
	age(p, hours);
	return p;
}

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	dir = mkdtempSync(join(tmpdir(), 'tmt-sweep-'));
});

describe('sweepImportsDir', () => {
	it('removes old matching leftovers and keeps fresh, unknown and queued ones', async () => {
		const tid = db.select({ id: templates.id }).from(templates).get()!.id;
		const queued = file(`${U1}.zip`, 5);
		db.insert(templateModelJobs)
			.values({ templateId: tid, status: 'queued', inputPath: queued })
			.run();
		const oldZip = file(`${U2}.zip`, 5);
		const oldUpload = file(`geometry-${U3}.upload`, 2);
		const oldPart = file(`${U2}.zip.part`, 2);
		const fresh = file(`${U3}.zip`, 0);
		const unknown = file('notes.txt', 50);
		const oldDir = join(dir, 'nested-abc123');
		mkdirSync(oldDir);
		writeFileSync(join(oldDir, '0.3mf'), 'x');
		age(oldDir, 3);
		const freshDir = join(dir, 'nested-zzz999');
		mkdirSync(freshDir);

		const n = await sweepImportsDir(db, { dir });
		expect(n).toBe(4);
		for (const p of [oldZip, oldUpload, oldPart, oldDir]) expect(existsSync(p)).toBe(false);
		for (const p of [queued, fresh, unknown, freshDir]) expect(existsSync(p)).toBe(true);
		expect(await sweepImportsDir(db, { dir })).toBe(0);
	});

	it('never follows or removes symlinks', async () => {
		const target = mkdtempSync(join(tmpdir(), 'tmt-sweep-target-'));
		writeFileSync(join(target, 'keep.txt'), 'x');
		const link = join(dir, 'nested-abc123');
		symlinkSync(target, link);
		expect(await sweepImportsDir(db, { dir })).toBe(0);
		expect(existsSync(join(target, 'keep.txt'))).toBe(true);
	});

	it('is fine when the directory is missing', async () => {
		expect(await sweepImportsDir(db, { dir: join(dir, 'nope') })).toBe(0);
	});
});
