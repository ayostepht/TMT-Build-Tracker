import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import { templateModelJobs, templateModels, templates, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { assertTemplateAdmin } from './guard';
import { createJob, failStaleModelJobs, getJob, runQueue, setConverter } from './jobs';
import type { ConvertResult } from './convert';

let db: Db;
let tid: string;
let dir: string;

const result: ConvertResult = {
	version: 'abc123',
	size: 1234,
	slugs: ['seat-center'],
	triangles: 10,
	ms: 5,
	report: [{ file: 'a.step', slug: 'seat-center', status: 'ok' }]
};
const zip = (name: string) => {
	const p = join(dir, name);
	writeFileSync(p, 'PK');
	return p;
};

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	tid = db.select().from(templates).get()!.id;
	dir = mkdtempSync(join(tmpdir(), 'tmt-jobs-'));
});
afterEach(() => setConverter(null));

describe('model jobs', () => {
	it('goes queued -> running -> done, records the model and deletes the zip', async () => {
		const seen: string[] = [];
		const input = zip('a.zip');
		const job = createJob(db, {
			templateId: tid,
			inputPath: input,
			userId: null,
			fileName: 'steps.zip'
		});
		expect(job.status).toBe('queued');
		setConverter(async (_p, t, onProgress) => {
			seen.push(getJob(db, tid, job.id)!.status);
			expect(t.parts.length).toBeGreaterThan(10);
			onProgress(50, 'half way');
			expect(getJob(db, tid, job.id)!.progress).toBe(50);
			return result;
		});
		await runQueue(db);
		expect(seen).toEqual(['running']);
		const done = getJob(db, tid, job.id)!;
		expect(done.status).toBe('done');
		expect(done.progress).toBe(100);
		expect(done.finishedAt).toBeInstanceOf(Date);
		expect(done.report).toHaveLength(1);
		const model = db.select().from(templateModels).where(eq(templateModels.templateId, tid)).get()!;
		expect(model.version).toBe('abc123');
		expect(model.sourceNote).toContain('steps.zip');
		expect(existsSync(input)).toBe(false);
	});

	it('marks the job failed with the error message', async () => {
		const job = createJob(db, {
			templateId: tid,
			inputPath: zip('b.zip'),
			userId: null,
			fileName: 'x.zip'
		});
		setConverter(async () => {
			throw new Error('out of memory');
		});
		await runQueue(db);
		const j = getJob(db, tid, job.id)!;
		expect(j.status).toBe('failed');
		expect(j.message).toBe('out of memory');
		expect(db.select().from(templateModels).all()).toHaveLength(0);
	});

	it('refuses a second job for the same kit while one is active', () => {
		createJob(db, { templateId: tid, inputPath: zip('c.zip'), userId: null, fileName: 'x.zip' });
		expect(() =>
			createJob(db, { templateId: tid, inputPath: zip('d.zip'), userId: null, fileName: 'y.zip' })
		).toThrowError(expect.objectContaining({ status: 409 }));
	});

	it('runs jobs one at a time, oldest first', async () => {
		const other = db
			.insert(templates)
			.values({ slug: 'other', name: 'Other', version: '1' })
			.returning()
			.get();
		const a = createJob(db, {
			templateId: tid,
			inputPath: zip('e.zip'),
			userId: null,
			fileName: 'a.zip'
		});
		await new Promise((r) => setTimeout(r, 3));
		const b = createJob(db, {
			templateId: other.id,
			inputPath: zip('f.zip'),
			userId: null,
			fileName: 'b.zip'
		});
		let running = 0;
		let maxRunning = 0;
		const order: string[] = [];
		setConverter(async (_p, t) => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			order.push(t.id);
			await new Promise((r) => setTimeout(r, 5));
			running--;
			return result;
		});
		await Promise.all([runQueue(db), runQueue(db)]);
		expect(maxRunning).toBe(1);
		expect(order).toEqual([tid, other.id]);
		expect(getJob(db, other.id, b.id)!.status).toBe('done');
		expect(getJob(db, tid, a.id)!.status).toBe('done');
	});

	it('fails stale running jobs on startup but leaves queued ones', () => {
		const running = createJob(db, {
			templateId: tid,
			inputPath: zip('g.zip'),
			userId: null,
			fileName: 'x.zip'
		});
		db.update(templateModelJobs)
			.set({ status: 'running' })
			.where(eq(templateModelJobs.id, running.id))
			.run();
		expect(failStaleModelJobs(db)).toBe(1);
		const j = getJob(db, tid, running.id)!;
		expect(j.status).toBe('failed');
		expect(j.message).toMatch(/restart/);
		const queued = createJob(db, {
			templateId: tid,
			inputPath: zip('h.zip'),
			userId: null,
			fileName: 'x.zip'
		});
		expect(failStaleModelJobs(db)).toBe(0);
		expect(getJob(db, tid, queued.id)!.status).toBe('queued');
	});
});

describe('model admin permissions', () => {
	it('lets only the site admin through and hides everything else as 404', () => {
		db.insert(user)
			.values({ id: 'u1', name: 'First', email: 'first@example.test', createdAt: new Date(1000) })
			.run();
		db.insert(user)
			.values({ id: 'u2', name: 'Second', email: 'second@example.test', createdAt: new Date(2000) })
			.run();
		expect(() =>
			assertTemplateAdmin(db, { id: 'u1', email: 'first@example.test' }, tid)
		).not.toThrow();
		expect(() =>
			assertTemplateAdmin(db, { id: 'u2', email: 'second@example.test' }, tid)
		).toThrowError(expect.objectContaining({ status: 404 }));
		expect(() => assertTemplateAdmin(db, { id: 'u1' }, 'missing')).toThrowError(ApiError);
	});
});

describe('runQueue', () => {
	it('picks up a job queued after an earlier run found the queue empty', async () => {
		await runQueue(db);
		setConverter(async () => result);
		const job = createJob(db, {
			templateId: tid,
			inputPath: zip('late.zip'),
			userId: null,
			fileName: 'x.zip'
		});
		await runQueue(db);
		expect(getJob(db, tid, job.id)!.status).toBe('done');
	});
});
