import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import { templateModelJobs, templateModels, templates, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { assertTemplateAdmin } from './guard';
import { QuotaError } from '../quota';
import {
	countActiveConversions,
	createJob,
	failStaleModelJobs,
	getJob,
	runQueue,
	setConverter
} from './jobs';
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
afterEach(() => {
	setConverter(null);
	vi.unstubAllEnvs();
});

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

describe('conversion slots per user', () => {
	const mkTpl = (slug: string) =>
		db.insert(templates).values({ slug, name: slug, version: '1' }).returning().get().id;
	const job = (templateId: string, userId: string | null, name: string) =>
		createJob(db, { templateId, inputPath: zip(name), userId, fileName: name });

	beforeEach(() => {
		for (const [i, id] of ['adm', 'u1', 'u2'].entries())
			db.insert(user)
				.values({ id, name: id, email: `${id}@x.test`, createdAt: new Date(5 + i) })
				.run();
	});

	it('limit 1: a second queued job is refused (409 + code), other users are not', () => {
		vi.stubEnv('QUOTA_STEP_CONVERSIONS_PER_USER', '1');
		const t2 = mkTpl('t2');
		job(tid, 'u1', 'a.zip');
		let err: unknown;
		try {
			job(t2, 'u1', 'b.zip');
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(QuotaError);
		expect(err).toMatchObject({ status: 409, code: 'quota' });
		expect(() => job(t2, 'u2', 'c.zip')).not.toThrow();
	});

	it('unlimited when unset', () => {
		const ids = [tid, mkTpl('t2'), mkTpl('t3')];
		for (const [i, t] of ids.entries()) job(t, 'u1', `${i}.zip`);
		expect(countActiveConversions(db, 'u1')).toBe(3);
	});

	it('the slot frees after success and after failure', async () => {
		vi.stubEnv('QUOTA_STEP_CONVERSIONS_PER_USER', '1');
		const t2 = mkTpl('t2');
		job(tid, 'u1', 'a.zip');
		setConverter(async () => result);
		await runQueue(db);
		job(t2, 'u1', 'b.zip'); // done freed it
		setConverter(async () => {
			throw new Error('boom');
		});
		await runQueue(db);
		expect(() => job(tid, 'u1', 'c.zip')).not.toThrow(); // failed freed it
	});

	it('a stale running row blocks until startup fails it, then frees the slot', () => {
		vi.stubEnv('QUOTA_STEP_CONVERSIONS_PER_USER', '1');
		const j = job(tid, 'u1', 'a.zip');
		db.update(templateModelJobs)
			.set({ status: 'running' })
			.where(eq(templateModelJobs.id, j.id))
			.run();
		expect(() => job(mkTpl('t2'), 'u1', 'b.zip')).toThrow(QuotaError);
		expect(failStaleModelJobs(db)).toBe(1);
		expect(() => job(mkTpl('t3'), 'u1', 'c.zip')).not.toThrow();
	});

	it('site admin is exempt', () => {
		vi.stubEnv('QUOTA_STEP_CONVERSIONS_PER_USER', '1');
		job(tid, 'adm', 'a.zip'); // the earliest user is the site admin on a self-hosted install
		expect(() => job(mkTpl('t2'), 'adm', 'b.zip')).not.toThrow();
	});
});
