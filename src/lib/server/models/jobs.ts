import { unlink } from 'node:fs/promises';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { ApiError } from '../access.ts';
import { templateModelPath } from '../config.ts';
import type { Db } from '../db/index.ts';
import { templateModelJobs, templateModels, templateParts } from '../db/schema.ts';
import { convertStepZip, type ConvertResult, type ConvertTemplate } from './convert.ts';

export type ModelJob = typeof templateModelJobs.$inferSelect;
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export type Converter = (
	zipPath: string,
	template: ConvertTemplate,
	onProgress: (pct: number, message: string) => void
) => Promise<ConvertResult>;

let converter: Converter = convertStepZip;
/** Tests swap the converter for a fake. */
export function setConverter(fn: Converter | null): void {
	converter = fn ?? convertStepZip;
}

export function createJob(
	db: Db,
	input: { templateId: string; inputPath: string; userId: string | null; fileName: string }
): ModelJob {
	const active = db
		.select({ id: templateModelJobs.id })
		.from(templateModelJobs)
		.where(
			and(
				eq(templateModelJobs.templateId, input.templateId),
				inArray(templateModelJobs.status, ['queued', 'running'])
			)
		)
		.get();
	if (active) throw new ApiError(409, 'A conversion for this kit is already queued or running');
	return db
		.insert(templateModelJobs)
		.values({
			templateId: input.templateId,
			inputPath: input.inputPath,
			createdBy: input.userId,
			// While queued, the message holds the uploaded file name (used for the model's source note).
			message: input.fileName.slice(0, 200)
		})
		.returning()
		.get();
}

export function getJob(db: Db, templateId: string, jobId: string): ModelJob | undefined {
	return db
		.select()
		.from(templateModelJobs)
		.where(and(eq(templateModelJobs.id, jobId), eq(templateModelJobs.templateId, templateId)))
		.get();
}

export function latestJob(db: Db, templateId: string): ModelJob | undefined {
	return db
		.select()
		.from(templateModelJobs)
		.where(eq(templateModelJobs.templateId, templateId))
		.orderBy(desc(templateModelJobs.createdAt), desc(templateModelJobs.id))
		.get();
}

/** A server restart kills the converter child: mark jobs that were running as failed. */
export function failStaleModelJobs(db: Db): number {
	const stale = db
		.update(templateModelJobs)
		.set({ status: 'failed', message: 'Interrupted by a server restart', finishedAt: new Date() })
		.where(eq(templateModelJobs.status, 'running'))
		.returning({ id: templateModelJobs.id, inputPath: templateModelJobs.inputPath })
		.all();
	for (const j of stale) void unlink(j.inputPath).catch(() => {});
	return stale.length;
}

const quiet = () => {};

async function processJob(db: Db, job: ModelJob): Promise<void> {
	const fileName = job.message || 'upload.zip';
	db.update(templateModelJobs)
		.set({ status: 'running', progress: 1, message: 'Starting' })
		.where(eq(templateModelJobs.id, job.id))
		.run();
	let lastPct = -1;
	const onProgress = (pct: number, message: string) => {
		if (pct === lastPct && !message) return;
		lastPct = pct;
		db.update(templateModelJobs)
			.set({ progress: Math.min(99, Math.max(1, Math.round(pct))), message })
			.where(eq(templateModelJobs.id, job.id))
			.run();
	};
	try {
		const parts = db
			.select({
				slug: templateParts.slug,
				sourceFile: templateParts.sourceFile,
				components: templateParts.components
			})
			.from(templateParts)
			.where(eq(templateParts.templateId, job.templateId))
			.orderBy(asc(templateParts.sort))
			.all();
		const result = await converter(job.inputPath, { id: job.templateId, parts }, onProgress);
		const ok = result.report.filter((r) => r.status === 'ok').length;
		const missing = result.report.filter((r) => r.status === 'missing').length;
		const failed = result.report.filter((r) => r.status === 'failed').length;
		const sourceNote = `${fileName}: ${result.slugs.length} parts built from ${ok} files, ${missing} missing, ${failed} failed`;
		db.transaction((tx) => {
			tx.insert(templateModels)
				.values({
					templateId: job.templateId,
					glbPath: templateModelPath(job.templateId),
					version: result.version,
					size: result.size,
					slugs: result.slugs,
					sourceNote,
					createdBy: job.createdBy
				})
				.onConflictDoUpdate({
					target: templateModels.templateId,
					set: {
						glbPath: templateModelPath(job.templateId),
						version: result.version,
						size: result.size,
						slugs: result.slugs,
						sourceNote,
						createdBy: job.createdBy,
						createdAt: new Date()
					}
				})
				.run();
			tx.update(templateModelJobs)
				.set({
					status: 'done',
					progress: 100,
					message: sourceNote,
					report: result.report as unknown as Record<string, unknown>[],
					finishedAt: new Date()
				})
				.where(eq(templateModelJobs.id, job.id))
				.run();
		});
	} catch (e) {
		db.update(templateModelJobs)
			.set({
				status: 'failed',
				message: e instanceof Error ? e.message : String(e),
				finishedAt: new Date()
			})
			.where(eq(templateModelJobs.id, job.id))
			.run();
	} finally {
		await unlink(job.inputPath).catch(quiet);
	}
}

let draining: Promise<void> | null = null;

/** Runs queued jobs one at a time, oldest first. Resolves when the queue is empty; concurrent calls share the run. */
export function runQueue(db: Db): Promise<void> {
	if (draining) return draining;
	draining = (async () => {
		// Let `draining` be assigned before the first check, or an empty queue would leave a stale promise behind.
		await Promise.resolve();
		try {
			for (;;) {
				const next = db
					.select()
					.from(templateModelJobs)
					.where(eq(templateModelJobs.status, 'queued'))
					.orderBy(asc(templateModelJobs.createdAt), asc(templateModelJobs.id))
					.get();
				if (!next) return;
				await processJob(db, next);
			}
		} finally {
			draining = null;
		}
	})();
	return draining;
}

/** Fire-and-forget version of `runQueue` for request handlers and startup. */
export function kickQueue(db: Db): void {
	runQueue(db).catch((e) => console.error('[tmt] model queue error', e));
}
