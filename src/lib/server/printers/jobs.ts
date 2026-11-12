/**
 * Print-job lifecycle driven by printer status: a printer starts a file -> a `printer_jobs`
 * row (linked to a build plate when the file name or the build's printer settings say which);
 * it finishes -> the job is closed and either logged automatically (team setting) or left
 * waiting for the user's "Confirm print log". All state lives in the database, so a restart
 * resumes the active job by file name (elapsed time starting over means a new run).
 */
import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { fileMentionsBuild, matchPlate, plateRunGrams } from '#lib/domain/printer-match.ts';
import { jobNeverStarted, stopPrinting } from '#lib/domain/actions.ts';
import { releaseUnstarted } from '#lib/domain/recompute.ts';
import { progressGrams } from '#lib/domain/logrun.ts';
import { defaultRunParts } from '#lib/domain/run-choice.ts';
import { today } from '#lib/domain/format.ts';
import type { BuildView, PartPatch } from '#lib/domain/types.ts';
import type { PrinterExpectedView, PrinterJobView, PrinterStatus } from '#lib/printers/status.ts';
import { ApiError } from '../access';
import {
	addRun,
	addRunSystem,
	mutateBuild,
	mutateBuildSystem,
	syncPlateTime
} from '../builds/actions';
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

/** The highest progress seen: a final status that reads 0 (firmware resets it on cancel) never lowers it. */
function maxProgress(a: number | null | undefined, b: number | null | undefined): number | null {
	if (a == null) return b ?? null;
	if (b == null) return a;
	return Math.max(a, b);
}

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
	/** Parts the user chose (an expectation or a manual link); otherwise the default rule applies. */
	partSlugs?: string[];
}

/**
 * Validate a client-sent part list for a plate: a non-empty list of active parts on that plate.
 * Returns undefined when none was sent.
 */
export function checkPartSlugs(
	view: BuildView,
	plateNumber: number,
	raw: unknown
): string[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	const plate = view.plates.find((p) => p.number === plateNumber);
	if (
		!Array.isArray(raw) ||
		!raw.length ||
		raw.length > 100 ||
		!raw.every((x) => typeof x === 'string')
	)
		throw new ApiError(400, 'partSlugs must be a non-empty list of part slugs');
	const slugs = [...new Set(raw as string[])];
	if (!plate || !slugs.every((s) => plate.parts.includes(s) && view.state[s]))
		throw new ApiError(400, 'partSlugs must be active parts on that plate');
	return slugs;
}

/**
 * Find the build plate a printer file belongs to, or null when it is not clear. Only the file name
 * decides: a job is never linked by guessing (a "Start on <printer>" click is a suggestion the user
 * confirms, see `pendingExpected`).
 */
export function findPlateForFile(db: Db, printer: PrinterRow, fileName: string): Candidate | null {
	const actor = getMemberActor(db, printer.organizationId);
	if (!actor) return null;
	const rows = db
		.select({ id: builds.id, phase: builds.phase })
		.from(builds)
		.where(
			and(
				eq(builds.organizationId, printer.organizationId),
				ne(builds.phase, 'done'),
				eq(builds.kind, 'build')
			)
		)
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
	return hits.length === 1 ? hits[0] : null;
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
	const slugs = c.partSlugs?.length
		? c.partSlugs
		: (defaultRunParts(c.view, c.plate) ??
			(printingNow.length ? printingNow : plate.parts.filter((s) => c.view.state[s])));
	// Changing the parts of a job that is already linked: the dropped ones stop printing.
	const dropped =
		job.buildId === c.view.build.id && job.plateNumber === c.plate
			? (job.partSlugs ?? []).filter((s) => !slugs.includes(s))
			: [];
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
		const live = job.status === 'printing' || job.status === 'paused';
		const patches = live ? linkPatches(view, slugs, started, est) : [];
		// the run time the printer reported is the plate's time too (never over a typed one)
		if (live && est && patches.some((p) => p.runEstSeconds === est))
			syncPlateTime(tx, c.view.build.id, view, slugs, est, 'printer');
		return {
			kind: auto ? 'printer.job.start' : 'printer.job.link',
			payload,
			patches:
				job.status === 'printing' || job.status === 'paused'
					? [...stopPrinting(view, dropped), ...patches]
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

const EXPECTED_MAX_AGE_MS = 12 * 3600_000;

/** A new unlinked job: a fresh suggestion sent before it started becomes about this job; stale ones go. */
function bindExpected(db: Db, printer: PrinterRow, job: JobRow) {
	const exp = getExpected(db, printer.organizationId, printer.id);
	if (!exp) return;
	if (exp.jobId || Date.now() - exp.at >= EXPECTED_MAX_AGE_MS)
		setExpected(db, printer.organizationId, printer.id, null);
	else setExpected(db, printer.organizationId, printer.id, { ...exp, jobId: job.id });
}

/**
 * "Start on <printer>": remember which plate the user says is printing there. With an unlinked
 * job already running it is about that job; otherwise about the next one that starts.
 */
export function expectOnPrinterJob(
	db: Db,
	printerId: string,
	e: { buildId: string; plate: number; partSlugs?: string[] }
): void {
	const printer = db.select().from(printers).where(eq(printers.id, printerId)).get();
	if (!printer) throw new ApiError(404, 'Not found');
	const j = activeJob(db, printerId);
	setExpected(db, printer.organizationId, printerId, {
		buildId: e.buildId,
		plate: e.plate,
		...(e.partSlugs ? { partSlugs: e.partSlugs } : {}),
		...(j && !j.buildId ? { jobId: j.id } : {}),
		at: Date.now()
	});
	emitPrinterEvent(printer.organizationId, { type: 'job', printerId });
}

/** Suggestions for a build (or, without `buildId`, for every build of the team): its plate was sent to a printer that now runs an unlinked job. */
export function pendingExpected(db: Db, orgId: string, buildId?: string): PrinterExpectedView[] {
	const out: PrinterExpectedView[] = [];
	for (const p of db.select().from(printers).where(eq(printers.organizationId, orgId)).all()) {
		const exp = getExpected(db, orgId, p.id);
		if (!exp || (buildId && exp.buildId !== buildId) || !exp.jobId) continue;
		if (Date.now() - exp.at >= EXPECTED_MAX_AGE_MS) continue;
		const j = activeJob(db, p.id);
		if (!j || j.id !== exp.jobId || j.buildId) continue;
		out.push({
			printerId: p.id,
			printerName: p.name,
			buildId: exp.buildId,
			plateNumber: exp.plate,
			partSlugs: exp.partSlugs ?? null,
			jobId: j.id,
			at: exp.at
		});
	}
	return out;
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
	else bindExpected(db, printer, job);
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
			progress: result === 'done' ? 100 : maxProgress(s.progress, job.progress)
		})
		.where(eq(printerJobs.id, job.id))
		.run();
	// A suggestion is about one job: it ends with it.
	if (getExpected(db, printer.organizationId, printer.id)?.jobId === job.id)
		setExpected(db, printer.organizationId, printer.id, null);
	if (!job.buildId || job.plateNumber == null) return;
	const actor = getMemberActor(db, printer.organizationId);
	if (!actor) return;
	const view = loadBuildView(db, job.buildId, actor);
	if (!view) return;
	// Cancelled or failed before anything printed: nothing to log, whatever the auto-log setting.
	if (result !== 'done') {
		const progress = maxProgress(s.progress, job.progress);
		if (jobNeverStarted({ progress, layer: s.layer, elapsedSec: elapsed })) {
			db.update(printerJobs).set({ runId: DISMISSED }).where(eq(printerJobs.id, job.id)).run();
			releaseParts(db, printer, job, undefined, 'printer.job.unstarted', result);
			return;
		}
	}
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
	// A perPartRuns plate counts runs per part: one part is logged as `partSlug`.
	const single = plate?.perPartRuns && job.partSlugs?.length === 1 ? job.partSlugs[0] : null;
	const subset =
		!single && job.partSlugs && plate && job.partSlugs.length < plate.parts.length
			? job.partSlugs
			: null;
	return {
		plateNumber: job.plateNumber,
		partSlug: single,
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
			// Stored progress only goes up while the job is live (a poll that dips to 0 changes nothing).
			const best = maxProgress(s.progress, active.progress);
			const moved = best != null && Math.abs(best - (active.progress ?? -10)) >= 1;
			if (status !== active.status || moved) {
				db.update(printerJobs)
					.set({ status, progress: best })
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

/**
 * The team's job history for the Printers page: the most recent jobs linked to a plate, plus
 * unlinked ones (a running one is offered for linking; the rest sit behind "Other prints on
 * this printer"). The client splits them with `splitTeamJobs`; nothing is deleted.
 */
export function teamJobs(db: Db, orgId: string, limit = 15, otherLimit = 30): PrinterJobView[] {
	const rows = (linked: boolean, n: number) =>
		db
			.select({ job: printerJobs, name: printers.name })
			.from(printerJobs)
			.innerJoin(printers, eq(printers.id, printerJobs.printerId))
			.where(
				and(
					eq(printers.organizationId, orgId),
					linked ? isNotNull(printerJobs.buildId) : isNull(printerJobs.buildId)
				)
			)
			.orderBy(desc(printerJobs.startedAt))
			.limit(n)
			.all()
			.map((r) => toJobView(r.job, r.name));
	return [...rows(true, limit), ...rows(false, otherLimit)].sort((a, b) =>
		(b.startedAt ?? '').localeCompare(a.startedAt ?? '')
	);
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
	plateNumber: number,
	partSlugs?: unknown
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
	if (view.build.kind === 'draft')
		throw new ApiError(400, 'Drafts cannot be linked to print jobs.');
	if (!view.plates.some((p) => p.number === plateNumber)) throw new ApiError(400, 'Unknown plate');
	const chosen = checkPartSlugs(view, plateNumber, partSlugs);
	const status = (printer.lastStatus ?? {
		state: 'printing',
		progress: job.progress
	}) as unknown as PrinterStatus;
	attach(db, printer, job, { view, plate: plateNumber, partSlugs: chosen }, status, false, userId);
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

/**
 * A job ended and nothing was logged for it: its parts that are still Printing (and that no other
 * active job covers) go back to their status from before the print.
 */
function releaseParts(
	db: Db,
	printer: PrinterRow,
	job: JobRow,
	userId?: string,
	kind = 'printer.job.release',
	result?: string
) {
	if (!job.buildId || !job.partSlugs?.length) return;
	const buildId = job.buildId;
	const others = db
		.select()
		.from(printerJobs)
		.where(
			and(
				eq(printerJobs.buildId, buildId),
				ne(printerJobs.id, job.id),
				inArray(printerJobs.status, ['printing', 'paused'])
			)
		)
		.all();
	const held = new Set(others.flatMap((o) => o.partSlugs ?? []));
	const slugs = job.partSlugs.filter((s) => !held.has(s));
	const body = (_tx: Db, view: BuildView) => ({
		kind,
		payload: {
			printer: printer.name,
			printerId: printer.id,
			jobId: job.id,
			plateNumber: job.plateNumber,
			fileName: job.fileName,
			...(result ? { result } : {})
		},
		patches: releaseUnstarted(view, slugs)
	});
	if (userId) mutateBuild(db, buildId, userId, body);
	else {
		const actor = getMemberActor(db, printer.organizationId);
		if (actor) mutateBuildSystem(db, buildId, actor, printer.name, body);
	}
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
	const finished = job.status === 'done';
	const result =
		o.result === 'Failed' || o.result === 'Partial' || o.result === 'Success'
			? o.result
			: finished
				? 'Success'
				: 'Failed';
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
		finished
			? plateRunGrams(view, job.plateNumber, job.partSlugs ?? undefined)
			: progressGrams(
					plateRunGrams(view, job.plateNumber, job.partSlugs ?? undefined),
					job.progress
				),
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

export function dismissJob(db: Db, jobId: string, orgId: string, userId?: string): void {
	const { job, printer } = getJobForOrg(db, jobId, orgId);
	if (job.status === 'printing' || job.status === 'paused')
		throw new ApiError(409, 'The print is still running');
	const unlogged = !job.runId;
	db.update(printerJobs).set({ runId: DISMISSED }).where(eq(printerJobs.id, jobId)).run();
	if (unlogged) releaseParts(db, printer, job, userId);
	if (job.buildId)
		emitBuildEvent(job.buildId, {
			type: 'changed',
			kind: 'printer.job.dismiss',
			by: null,
			at: new Date().toISOString()
		});
	emitPrinterEvent(orgId, { type: 'job', printerId: printer.id });
}
