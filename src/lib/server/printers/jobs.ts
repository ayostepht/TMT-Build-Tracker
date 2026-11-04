/**
 * Print-job lifecycle driven by printer status: a printer starts a file -> a `printer_jobs`
 * row (linked to a build plate when the file name or the build's printer settings say which);
 * it finishes -> the job is closed and either logged automatically (team setting) or left
 * waiting for the user's "Confirm print log". All state lives in the database, so a restart
 * resumes the active job by file name (elapsed time starting over means a new run).
 */
import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { fileMentionsBuild, matchPlate, plateRunGrams } from '#lib/domain/printer-match.ts';
import { today } from '#lib/domain/format.ts';
import type { BuildView, PartPatch } from '#lib/domain/types.ts';
import type { PrinterJobView, PrinterStatus } from '#lib/printers/status.ts';
import { ApiError } from '../access';
import { addRun, addRunSystem, mutateBuild, mutateBuildSystem } from '../builds/actions';
import { loadBuildView } from '../builds/view';
import type { Db } from '../db';
import { builds, printerJobs, printers } from '../db/schema';
import { emitBuildEvent } from '../events';
import { getExpected, getOrgSettings, setExpected } from '../org-settings';
import { syncRunDeduction } from '../spoolman/deduct';
import { emitPrinterEvent } from './bus';
import { getMemberActor } from './system';

type PrinterRow = typeof printers.$inferSelect;
type JobRow = typeof printerJobs.$inferSelect;

const RESTART_ELAPSED_SEC = 120;
export const DISMISSED = 'dismissed';

export function activeJob(db: Db, printerId: string): JobRow | undefined {
	return db
		.select()
		.from(printerJobs)
		.where(
			and(eq(printerJobs.printerId, printerId), inArray(printerJobs.status, ['printing', 'paused']))
		)
		.orderBy(desc(printerJobs.startedAt))
		.limit(1)
		.get();
}

function samePrinterBuild(view: BuildView, printer: PrinterRow): boolean {
	const bp = view.printer;
	if (!bp) return false;
	if (bp.catalogId && printer.catalogId && bp.catalogId === printer.catalogId) return true;
	return bp.name.trim().toLowerCase() === printer.name.trim().toLowerCase();
}

interface Candidate {
	view: BuildView;
	plate: number;
}

/** Find the build plate a printer file belongs to, or null when it is not clear. */
export function findPlateForFile(db: Db, printer: PrinterRow, fileName: string): Candidate | null {
	const actor = getMemberActor(db, printer.organizationId);
	if (!actor) return null;
	const exp = getExpected(db, printer.organizationId, printer.id);
	if (exp && Date.now() - exp.at < 12 * 3600_000) {
		const v = loadBuildView(db, exp.buildId, actor);
		if (v && v.plates.some((p) => p.number === exp.plate)) return { view: v, plate: exp.plate };
	}
	const rows = db
		.select({ id: builds.id, phase: builds.phase })
		.from(builds)
		.where(and(eq(builds.organizationId, printer.organizationId), ne(builds.phase, 'done')))
		.all();
	const views = rows.map((r) => loadBuildView(db, r.id, actor)).filter((v): v is BuildView => !!v);

	let hits: Candidate[] = [];
	for (const v of views) {
		const n = matchPlate(fileName, v.plates);
		if (n !== null) hits.push({ view: v, plate: n });
	}
	const printingOn = (c: Candidate) =>
		((v) =>
			v.plates
				.find((p) => p.number === c.plate)
				?.parts.some((s) => v.state[s]?.status === 'Printing'))(c.view);
	if (hits.length > 1) {
		const named = hits.filter((c) => fileMentionsBuild(fileName, c.view.build.name));
		if (named.length) hits = named;
	}
	if (hits.length > 1) {
		const mine = hits.filter((c) => samePrinterBuild(c.view, printer));
		if (mine.length) hits = mine;
	}
	if (hits.length > 1) {
		const pr = hits.filter(printingOn);
		if (pr.length) hits = pr;
	}
	if (hits.length === 1) return hits[0];
	if (hits.length > 1) return null;

	// No name match: the one build planned for this printer with exactly one plate marked Printing.
	const cands: Candidate[] = [];
	for (const v of views) {
		if (!samePrinterBuild(v, printer)) continue;
		for (const pl of v.plates)
			if (pl.parts.some((s) => v.state[s]?.status === 'Printing'))
				cands.push({ view: v, plate: pl.number });
	}
	return cands.length === 1 ? cands[0] : null;
}

function linkPatches(
	view: BuildView,
	slugs: string[],
	startedAt: Date,
	estSeconds: number | null
): PartPatch[] {
	const iso = startedAt.toISOString();
	const out: PartPatch[] = [];
	for (const slug of slugs) {
		const st = view.state[slug];
		if (!st) continue;
		const p: PartPatch = { slug };
		if (st.status !== 'Printing') {
			p.status = 'Printing';
			p.startedAt = iso;
		} else if (!st.startedAt) p.startedAt = iso;
		if (estSeconds && !st.runEstSeconds) p.runEstSeconds = estSeconds;
		if (Object.keys(p).length > 1) out.push(p);
	}
	return out;
}

/** Attach a job to a plate: parts go to Printing with the job's start time. */
function attach(
	db: Db,
	printer: PrinterRow,
	job: JobRow,
	c: Candidate,
	status: PrinterStatus,
	auto: boolean,
	userId?: string
) {
	setExpected(db, printer.organizationId, printer.id, null);
	const plate = c.view.plates.find((p) => p.number === c.plate)!;
	const printingNow = plate.parts.filter((s) => c.view.state[s]?.status === 'Printing');
	const slugs = printingNow.length ? printingNow : plate.parts.filter((s) => c.view.state[s]);
	const started = job.startedAt ?? new Date();
	const est =
		status.elapsedSec != null && status.remainingSec != null
			? Math.round(status.elapsedSec + status.remainingSec)
			: null;
	const payload = {
		printer: printer.name,
		printerId: printer.id,
		jobId: job.id,
		plateNumber: c.plate,
		fileName: job.fileName,
		auto
	};
	const body = (tx: Db, view: BuildView) => {
		tx.update(printerJobs)
			.set({ buildId: c.view.build.id, plateNumber: c.plate, partSlugs: slugs })
			.where(eq(printerJobs.id, job.id))
			.run();
		return {
			kind: auto ? 'printer.job.start' : 'printer.job.link',
			payload,
			patches:
				job.status === 'printing' || job.status === 'paused'
					? linkPatches(view, slugs, started, est)
					: []
		};
	};
	if (userId) mutateBuild(db, c.view.build.id, userId, (tx, view) => body(tx, view));
	else {
		const actor = getMemberActor(db, printer.organizationId);
		if (actor)
			mutateBuildSystem(db, c.view.build.id, actor, printer.name, (tx, view) => body(tx, view));
	}
}

function createJob(db: Db, printer: PrinterRow, s: PrinterStatus, now: Date): JobRow {
	const startedAt = s.elapsedSec != null ? new Date(now.getTime() - s.elapsedSec * 1000) : now;
	const job = db
		.insert(printerJobs)
		.values({
			printerId: printer.id,
			fileName: s.fileName ?? '',
			status: s.state === 'paused' ? 'paused' : 'printing',
			progress: s.progress,
			startedAt
		})
		.returning()
		.get();
	const c = findPlateForFile(db, printer, job.fileName);
	if (c) attach(db, printer, job, c, s, true);
	return db.select().from(printerJobs).where(eq(printerJobs.id, job.id)).get()!;
}

function finishJob(
	db: Db,
	printer: PrinterRow,
	job: JobRow,
	result: 'done' | 'failed' | 'cancelled',
	s: PrinterStatus,
	now: Date
) {
	const elapsed =
		s.elapsedSec ??
		(job.startedAt ? Math.max(0, (now.getTime() - job.startedAt.getTime()) / 1000) : null);
	db.update(printerJobs)
		.set({
			status: result,
			finishedAt: now,
			progress: result === 'done' ? 100 : (s.progress ?? job.progress)
		})
		.where(eq(printerJobs.id, job.id))
		.run();
	if (!job.buildId || job.plateNumber == null) return;
	const actor = getMemberActor(db, printer.organizationId);
	if (!actor) return;
	const view = loadBuildView(db, job.buildId, actor);
	if (!view) return;
	const grams = plateRunGrams(view, job.plateNumber, job.partSlugs ?? undefined);
	const settings = getOrgSettings(db, printer.organizationId);
	const auto = settings.autoLogPrints && result === 'done';
	const payload = {
		printer: printer.name,
		printerId: printer.id,
		jobId: job.id,
		plateNumber: job.plateNumber,
		fileName: job.fileName,
		result,
		auto,
		grams: auto ? grams : null
	};

	if (auto) {
		const runId = addRunSystem(
			db,
			job.buildId,
			actor,
			printer.name,
			runBody(view, job, 'Success', grams, elapsed, printer.name, now)
		);
		db.update(printerJobs).set({ runId }).where(eq(printerJobs.id, job.id)).run();
		void syncRunDeduction(db, job.buildId, runId);
	}
	mutateBuildSystem(db, job.buildId, actor, printer.name, () => ({
		kind: 'printer.job.done',
		payload
	}));
}

function runBody(
	view: BuildView,
	job: Pick<JobRow, 'plateNumber' | 'partSlugs'>,
	result: 'Success' | 'Failed' | 'Partial',
	grams: number | null,
	elapsedSec: number | null,
	printerName: string,
	now: Date,
	note?: string
) {
	const plate = view.plates.find((p) => p.number === job.plateNumber);
	const subset =
		job.partSlugs && plate && job.partSlugs.length < plate.parts.length ? job.partSlugs : null;
	return {
		plateNumber: job.plateNumber,
		partSlugs: subset,
		date: today(now),
		result,
		grams,
		hours: elapsedSec != null ? Math.round((elapsedSec / 3600) * 10) / 10 : null,
		printer: printerName,
		note: note ?? `Logged automatically from ${printerName}`
	};
}

export interface ProcessResult {
	changed: boolean;
}

/** Feed one status of a printer into the job lifecycle. Idempotent for repeated identical statuses. */
export function processStatus(
	db: Db,
	printerId: string,
	s: PrinterStatus,
	now = new Date()
): ProcessResult {
	const printer = db.select().from(printers).where(eq(printers.id, printerId)).get();
	if (!printer) return { changed: false };
	let active = activeJob(db, printerId);
	let changed = false;
	const running = (s.state === 'printing' || s.state === 'paused') && !!s.fileName;

	if (running) {
		if (active) {
			// Same file continuing. Elapsed print time does not move while paused, so wall-clock
			// arithmetic would split a paused job; a restart shows as elapsed time starting over.
			const restarted =
				s.elapsedSec != null && s.elapsedSec < RESTART_ELAPSED_SEC && (active.progress ?? 0) >= 10;
			const same = active.fileName === s.fileName && !restarted;
			if (!same) {
				finishJob(db, printer, active, 'cancelled', { ...s, progress: active.progress }, now);
				active = undefined;
				changed = true;
			}
		}
		if (!active) {
			createJob(db, printer, s, now);
			changed = true;
		} else {
			const status = s.state === 'paused' ? 'paused' : 'printing';
			const moved =
				s.progress != null && Math.abs((s.progress ?? 0) - (active.progress ?? -10)) >= 1;
			if (status !== active.status || moved) {
				db.update(printerJobs)
					.set({ status, progress: s.progress ?? active.progress })
					.where(eq(printerJobs.id, active.id))
					.run();
				changed = true;
			}
			// Retry the plate link every ~10% while unlinked (plates may have been marked Printing since).
			if (
				!active.buildId &&
				s.progress != null &&
				Math.floor(s.progress / 10) !== Math.floor((active.progress ?? 0) / 10)
			) {
				const c = findPlateForFile(db, printer, active.fileName);
				if (c) {
					attach(db, printer, active, c, s, true);
					changed = true;
				}
			}
		}
	} else if (
		active &&
		(s.state === 'done' || s.state === 'failed' || s.state === 'error' || s.state === 'idle')
	) {
		const result =
			s.state === 'done'
				? 'done'
				: s.state === 'idle'
					? (active.progress ?? 0) >= 98
						? 'done'
						: 'cancelled'
					: s.cancelled
						? 'cancelled'
						: 'failed';
		finishJob(
			db,
			printer,
			active,
			result,
			s.state === 'idle' ? { ...s, progress: active.progress } : s,
			now
		);
		changed = true;
	}
	if (changed) {
		emitPrinterEvent(printer.organizationId, { type: 'job', printerId });
		const j = activeJob(db, printerId);
		if (j?.buildId)
			emitBuildEvent(j.buildId, {
				type: 'changed',
				kind: 'printer.job.progress',
				by: printer.name,
				at: now.toISOString()
			});
	}
	return { changed };
}

// ---- API-facing operations

export function toJobView(j: JobRow, printerName: string): PrinterJobView {
	return {
		id: j.id,
		printerId: j.printerId,
		printerName,
		buildId: j.buildId,
		plateNumber: j.plateNumber,
		partSlugs: j.partSlugs ?? null,
		fileName: j.fileName,
		status: j.status as PrinterJobView['status'],
		progress: j.progress,
		startedAt: j.startedAt ? j.startedAt.toISOString() : null,
		finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
		runId: j.runId,
		pendingConfirm:
			!!j.buildId &&
			j.plateNumber != null &&
			!j.runId &&
			(j.status === 'done' || j.status === 'failed' || j.status === 'cancelled')
	};
}

/**
 * Jobs for a build's page: its own active jobs, finished ones still waiting for a print log,
 * and the team's active jobs nobody has linked to a plate yet (so they can be linked here).
 */
export function buildJobs(db: Db, buildId: string, orgId: string): PrinterJobView[] {
	const active = inArray(printerJobs.status, ['printing', 'paused']);
	const rows = db
		.select({ job: printerJobs, name: printers.name })
		.from(printerJobs)
		.innerJoin(printers, eq(printers.id, printerJobs.printerId))
		.where(
			or(
				and(eq(printerJobs.buildId, buildId), or(active, isNull(printerJobs.runId))),
				and(isNull(printerJobs.buildId), active, eq(printers.organizationId, orgId))
			)
		)
		.orderBy(desc(printerJobs.startedAt))
		.limit(30)
		.all();
	return rows
		.map((r) => toJobView(r.job, r.name))
		.filter((j) => j.status === 'printing' || j.status === 'paused' || j.pendingConfirm);
}

/** Jobs of a team's printers that nobody has linked to a plate yet (active ones first), plus recent history. */
export function teamJobs(db: Db, orgId: string, limit = 15): PrinterJobView[] {
	return db
		.select({ job: printerJobs, name: printers.name })
		.from(printerJobs)
		.innerJoin(printers, eq(printers.id, printerJobs.printerId))
		.where(eq(printers.organizationId, orgId))
		.orderBy(desc(printerJobs.startedAt))
		.limit(limit)
		.all()
		.map((r) => toJobView(r.job, r.name));
}

export function getJobForOrg(
	db: Db,
	jobId: string,
	orgId: string
): { job: JobRow; printer: PrinterRow } {
	const r = db
		.select({ job: printerJobs, printer: printers })
		.from(printerJobs)
		.innerJoin(printers, eq(printers.id, printerJobs.printerId))
		.where(and(eq(printerJobs.id, jobId), eq(printers.organizationId, orgId)))
		.get();
	if (!r) throw new ApiError(404, 'Not found');
	return r;
}

/** Manually link a job to a plate of a build in the same team (editor+). */
export function linkJob(
	db: Db,
	jobId: string,
	orgId: string,
	userId: string,
	buildId: string,
	plateNumber: number
): void {
	const { job, printer } = getJobForOrg(db, jobId, orgId);
	const b = db
		.select({ org: builds.organizationId })
		.from(builds)
		.where(eq(builds.id, buildId))
		.get();
	if (!b || b.org !== orgId) throw new ApiError(404, 'Build not found');
	const view = loadBuildView(db, buildId, userId);
	if (!view) throw new ApiError(404, 'Build not found');
	if (!view.plates.some((p) => p.number === plateNumber)) throw new ApiError(400, 'Unknown plate');
	const status = (printer.lastStatus ?? {
		state: 'printing',
		progress: job.progress
	}) as unknown as PrinterStatus;
	attach(db, printer, job, { view, plate: plateNumber }, status, false, userId);
	emitPrinterEvent(orgId, { type: 'job', printerId: printer.id });
}

export function unlinkJob(db: Db, jobId: string, orgId: string): void {
	const { job, printer } = getJobForOrg(db, jobId, orgId);
	db.update(printerJobs)
		.set({ buildId: null, plateNumber: null, partSlugs: null })
		.where(eq(printerJobs.id, jobId))
		.run();
	if (job.buildId)
		emitBuildEvent(job.buildId, {
			type: 'changed',
			kind: 'printer.job.unlink',
			by: null,
			at: new Date().toISOString()
		});
	emitPrinterEvent(orgId, { type: 'job', printerId: printer.id });
}

/** "Confirm print log": the user accepts or adjusts what a finished job should be logged as. */
export function confirmJob(
	db: Db,
	jobId: string,
	orgId: string,
	userId: string,
	body: unknown
): string {
	const { job, printer } = getJobForOrg(db, jobId, orgId);
	if (!job.buildId || job.plateNumber == null)
		throw new ApiError(400, 'Link the job to a plate first');
	if (job.status === 'printing' || job.status === 'paused')
		throw new ApiError(409, 'The print is not finished yet');
	if (job.runId && job.runId !== DISMISSED) throw new ApiError(409, 'This print is already logged');
	const o = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
	const result = o.result === 'Failed' || o.result === 'Partial' ? o.result : 'Success';
	const view = loadBuildView(db, job.buildId, userId);
	if (!view) throw new ApiError(404, 'Not found');
	const elapsed =
		job.startedAt && job.finishedAt
			? (job.finishedAt.getTime() - job.startedAt.getTime()) / 1000
			: null;
	const base = runBody(
		view,
		job,
		result,
		plateRunGrams(view, job.plateNumber, job.partSlugs ?? undefined),
		elapsed,
		printer.name,
		new Date(),
		`From ${printer.name}`
	);
	const merged = {
		...base,
		...(o.grams !== undefined ? { grams: o.grams } : {}),
		...(o.hours !== undefined ? { hours: o.hours } : {}),
		...(typeof o.note === 'string' ? { note: o.note } : {}),
		...(typeof o.date === 'string' ? { date: o.date } : {})
	};
	const runId = addRun(db, job.buildId, userId, merged);
	db.update(printerJobs).set({ runId }).where(eq(printerJobs.id, jobId)).run();
	emitPrinterEvent(orgId, { type: 'job', printerId: printer.id });
	return runId;
}

export function dismissJob(db: Db, jobId: string, orgId: string): void {
	const { job, printer } = getJobForOrg(db, jobId, orgId);
	if (job.status === 'printing' || job.status === 'paused')
		throw new ApiError(409, 'The print is still running');
	db.update(printerJobs).set({ runId: DISMISSED }).where(eq(printerJobs.id, jobId)).run();
	if (job.buildId)
		emitBuildEvent(job.buildId, {
			type: 'changed',
			kind: 'printer.job.dismiss',
			by: null,
			at: new Date().toISOString()
		});
	emitPrinterEvent(orgId, { type: 'job', printerId: printer.id });
}
