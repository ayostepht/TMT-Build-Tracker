import { and, eq } from 'drizzle-orm';
import {
	applyRun,
	runTargets,
	setPrintStart,
	setRunEstimate,
	setStatus,
	startPrinting,
	stopPrinting
} from '#lib/domain/index.ts';
import {
	BUILD_PHASES,
	PART_STATUSES,
	RUN_RESULTS,
	type BuildView,
	type PartPatch,
	type PartStatus,
	type PrintRunInput
} from '#lib/domain/types.ts';
import { ApiError, buildAccess, requireEditor, requireOwner } from '../access';
import type { Db } from '../db';
import {
	activity,
	buildFilaments,
	buildPlates,
	builds,
	organization,
	printRuns,
	user
} from '../db/schema';
import { emitBuildEvent } from '../events';
import { isPersonalOrg } from '../teams';
import { applyPatches, loadBuildView } from './view';

interface Outcome {
	kind: string;
	payload?: Record<string, unknown>;
	patches?: PartPatch[];
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function bad(msg: string): never {
	throw new ApiError(400, msg);
}
function optStr(v: unknown, field: string, max = 500): string | null | undefined {
	if (v === undefined) return undefined;
	if (v === null) return null;
	if (typeof v !== 'string' || v.length > max) bad(`${field} must be a string`);
	return v.trim() || null;
}
function optNum(v: unknown, field: string): number | null | undefined {
	if (v === undefined) return undefined;
	if (v === null) return null;
	if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) bad(`${field} must be a number >= 0`);
	return v;
}
function dateStr(v: unknown, field: string): string {
	if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad(`${field} must be YYYY-MM-DD`);
	return v;
}
function slugList(v: unknown, view: BuildView, field = 'slugs'): string[] {
	if (!Array.isArray(v) || v.length === 0) bad(`${field} must be a non-empty array`);
	for (const s of v) if (typeof s !== 'string' || !view.state[s]) bad(`Unknown part in ${field}`);
	return [...new Set(v as string[])];
}

/**
 * Run one mutation: permission check (404 non-member, 403 viewer), load the view,
 * let `fn` validate and compute, persist patches + an activity row in one
 * transaction, then emit the SSE event.
 */
export function mutateBuild(
	db: Db,
	buildId: string,
	userId: string,
	fn: (tx: Db, view: BuildView, now: Date) => Outcome
): void {
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	const now = new Date();
	const out = db.transaction((txRaw) => {
		const tx = txRaw as unknown as Db;
		const view = loadBuildView(tx, buildId, userId);
		if (!view) throw new ApiError(404, 'Not found');
		const o = fn(tx, view, now);
		if (o.patches?.length) applyPatches(tx, buildId, o.patches, now);
		tx.insert(activity)
			.values({ buildId, userId, kind: o.kind, payload: o.payload ?? {}, at: now })
			.run();
		return o;
	});
	publish(db, buildId, userId, out.kind, now);
}

function publish(db: Db, buildId: string, userId: string, kind: string, now: Date): void {
	const u = db.select({ name: user.name }).from(user).where(eq(user.id, userId)).get();
	emitBuildEvent(buildId, { type: 'changed', kind, by: u?.name ?? null, at: now.toISOString() });
}

export function updateBuild(db: Db, buildId: string, userId: string, body: unknown): void {
	if (!isObj(body)) bad('Invalid body');
	mutateBuild(db, buildId, userId, (tx) => {
		const set: Partial<typeof builds.$inferInsert> = {};
		if (body.name !== undefined) {
			if (typeof body.name !== 'string' || !body.name.trim()) bad('name is required');
			set.name = body.name.trim().slice(0, 200);
		}
		const recipient = optStr(body.recipient, 'recipient');
		if (recipient !== undefined) set.recipient = recipient;
		const hospital = optStr(body.hospital, 'hospital');
		if (hospital !== undefined) set.hospital = hospital;
		if (body.deliveryDate !== undefined)
			set.deliveryDate =
				body.deliveryDate === null ? null : dateStr(body.deliveryDate, 'deliveryDate');
		if (body.phase !== undefined) {
			if (!(BUILD_PHASES as readonly unknown[]).includes(body.phase)) bad('Unknown phase');
			set.phase = body.phase as string;
		}
		if (!Object.keys(set).length) bad('Nothing to update');
		tx.update(builds).set(set).where(eq(builds.id, buildId)).run();
		return { kind: 'build.update', payload: set };
	});
}

export function deleteBuild(db: Db, buildId: string, userId: string): void {
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	requireOwner(db, access.organizationId, userId);
	db.delete(builds).where(eq(builds.id, buildId)).run();
	publish(db, buildId, userId, 'build.delete', new Date());
}

export function setPartStatus(
	db: Db,
	buildId: string,
	userId: string,
	slug: string,
	body: unknown
): void {
	if (!isObj(body) || !(PART_STATUSES as readonly unknown[]).includes(body.status))
		bad('status must be one of ' + PART_STATUSES.join(', '));
	const status = body.status as PartStatus;
	mutateBuild(db, buildId, userId, (_tx, view, now) => {
		if (!view.state[slug]) throw new ApiError(404, 'Unknown part');
		return {
			kind: 'part.status',
			payload: { slug, from: view.state[slug].status, to: status },
			patches: setStatus(view, slug, status, now)
		};
	});
}

export function updatePart(
	db: Db,
	buildId: string,
	userId: string,
	slug: string,
	body: unknown
): void {
	if (!isObj(body)) bad('Invalid body');
	mutateBuild(db, buildId, userId, (tx, view) => {
		if (!view.state[slug]) throw new ApiError(404, 'Unknown part');
		const patch: PartPatch = { slug };
		if (body.comps !== undefined) {
			if (!isObj(body.comps)) bad('comps must be an object');
			const comps: Record<string, boolean> = {};
			for (const [k, v] of Object.entries(body.comps)) {
				if (typeof v !== 'boolean') bad('comps values must be booleans');
				comps[k] = v;
			}
			patch.comps = comps;
		}
		if (body.assigneeUserId !== undefined) {
			const a = body.assigneeUserId;
			if (a !== null && (typeof a !== 'string' || !view.members.some((m) => m.userId === a)))
				bad('assignee must be a chapter member');
			patch.assigneeUserId = a as string | null;
		}
		if (Object.keys(patch).length === 1) bad('Nothing to update');
		void tx;
		const payload: Obj = { slug };
		if (patch.comps) payload.comps = true;
		if ('assigneeUserId' in patch) payload.assigneeUserId = patch.assigneeUserId;
		return { kind: 'part.update', payload, patches: [patch] };
	});
}

export function printingAction(db: Db, buildId: string, userId: string, body: unknown): void {
	if (!isObj(body)) bad('Invalid body');
	const action = body.action;
	if (!['start', 'stop', 'setStart', 'setEstimate'].includes(action as string))
		bad('Unknown action');
	mutateBuild(db, buildId, userId, (_tx, view, now) => {
		const slugs = slugList(body.slugs, view);
		switch (action) {
			case 'start':
				return {
					kind: 'printing.start',
					payload: { slugs },
					patches: startPrinting(view, slugs, now)
				};
			case 'stop':
				return { kind: 'printing.stop', payload: { slugs }, patches: stopPrinting(view, slugs) };
			case 'setStart': {
				const when = typeof body.when === 'string' ? new Date(body.when) : null;
				if (!when || Number.isNaN(when.getTime())) bad('when must be an ISO date-time');
				return {
					kind: 'printing.setStart',
					payload: { slugs, when: when.toISOString() },
					patches: setPrintStart(view, slugs, when, now)
				};
			}
			default: {
				const seconds = optNum(body.seconds, 'seconds') ?? null;
				return {
					kind: 'printing.setEstimate',
					payload: { slugs, seconds },
					patches: setRunEstimate(view, slugs, seconds)
				};
			}
		}
	});
}

export function addRun(db: Db, buildId: string, userId: string, body: unknown): string {
	if (!isObj(body)) bad('Invalid body');
	let runId = '';
	mutateBuild(db, buildId, userId, (tx, view, now) => {
		const plateNumber = optNum(body.plateNumber, 'plateNumber') ?? null;
		if (plateNumber !== null && !view.plates.some((p) => p.number === plateNumber))
			bad('Unknown plate');
		const partSlug = optStr(body.partSlug, 'partSlug') ?? null;
		if (partSlug && !view.state[partSlug]) bad('Unknown part');
		const partSlugs =
			body.partSlugs === undefined || body.partSlugs === null
				? null
				: slugList(body.partSlugs, view, 'partSlugs');
		if (plateNumber === null && !partSlug && !partSlugs) bad('A run needs a plate or a part');
		if (!(RUN_RESULTS as readonly unknown[]).includes(body.result)) bad('Unknown result');
		const input: PrintRunInput = {
			plateNumber,
			partSlug,
			partSlugs,
			date: dateStr(body.date, 'date'),
			result: body.result as PrintRunInput['result'],
			grams: optNum(body.grams, 'grams') ?? null,
			hours: optNum(body.hours, 'hours') ?? null,
			printer: optStr(body.printer, 'printer', 100) ?? null,
			note: typeof body.note === 'string' ? body.note.slice(0, 2000) : ''
		};
		const row = tx
			.insert(printRuns)
			.values({
				buildId,
				plateNumber: input.plateNumber,
				partSlug: input.partSlug,
				partSlugs: input.partSlugs,
				date: input.date,
				result: input.result,
				grams: input.grams,
				hours: input.hours,
				printer: input.printer,
				userId,
				note: input.note
			})
			.returning({ id: printRuns.id })
			.get();
		runId = row.id;
		return {
			kind: 'run.add',
			payload: {
				runId,
				plateNumber,
				partSlug,
				partSlugs,
				grams: input.grams,
				result: input.result
			},
			patches: applyRun(view, input, now)
		};
	});
	return runId;
}

export function deleteRun(db: Db, buildId: string, userId: string, runId: string): void {
	mutateBuild(db, buildId, userId, (tx) => {
		const r = tx
			.select()
			.from(printRuns)
			.where(and(eq(printRuns.id, runId), eq(printRuns.buildId, buildId)))
			.get();
		if (!r) throw new ApiError(404, 'Run not found');
		tx.delete(printRuns).where(eq(printRuns.id, runId)).run();
		return {
			kind: 'run.delete',
			payload: { runId, plateNumber: r.plateNumber, partSlug: r.partSlug, result: r.result }
		};
	});
}

export function updatePlate(
	db: Db,
	buildId: string,
	userId: string,
	number: number,
	body: unknown
): void {
	if (!isObj(body)) bad('Invalid body');
	mutateBuild(db, buildId, userId, (tx, view) => {
		const plate = view.plates.find((p) => p.number === number);
		if (!plate) throw new ApiError(404, 'Unknown plate');
		const set: Partial<typeof buildPlates.$inferInsert> = {};
		const g = optNum(body.slicerGrams, 'slicerGrams');
		if (g !== undefined) set.slicerGrams = g;
		if (body.slicerByPart !== undefined) {
			if (!isObj(body.slicerByPart)) bad('slicerByPart must be an object');
			const m: Record<string, number> = {};
			for (const [k, v] of Object.entries(body.slicerByPart)) {
				if (!plate.parts.includes(k)) bad('Part is not on this plate');
				if (v === null) continue; // null clears the entry
				if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) bad('Grams must be >= 0');
				m[k] = v;
			}
			set.slicerByPart = m;
		}
		if (!Object.keys(set).length) bad('Nothing to update');
		tx.update(buildPlates)
			.set(set)
			.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.number, number)))
			.run();
		return { kind: 'plate.slicer', payload: { number, ...set } };
	});
}

export function updateFilament(
	db: Db,
	buildId: string,
	userId: string,
	role: string,
	body: unknown
): void {
	if (!isObj(body)) bad('Invalid body');
	mutateBuild(db, buildId, userId, (tx, view) => {
		if (!view.filaments.some((f) => f.key === role)) throw new ApiError(404, 'Unknown filament');
		const set: Partial<typeof buildFilaments.$inferInsert> = {};
		if (body.spools !== undefined) {
			if (
				typeof body.spools !== 'number' ||
				!Number.isInteger(body.spools) ||
				body.spools < 0 ||
				body.spools > 99
			)
				bad('spools must be an integer 0-99');
			set.spools = body.spools;
		}
		for (const f of ['name', 'material'] as const) {
			if (body[f] === undefined) continue;
			if (
				typeof body[f] !== 'string' ||
				!(body[f] as string).trim() ||
				(body[f] as string).length > 100
			)
				bad(`${f} must be a non-empty string`);
			set[f] = (body[f] as string).trim();
		}
		if (body.hex !== undefined) {
			if (typeof body.hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.hex))
				bad('hex must be like #1a2b3c');
			set.hex = body.hex.toLowerCase();
		}
		if (!Object.keys(set).length) bad('Nothing to update');
		tx.update(buildFilaments)
			.set(set)
			.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
			.run();
		const onlySpools = Object.keys(set).length === 1 && 'spools' in set;
		return { kind: onlySpools ? 'filament.spools' : 'filament.update', payload: { role, ...set } };
	});
}

/**
 * Undo a just-logged run: delete it and put the targeted parts back to the state the client
 * saw before logging. Only parts that run affects may be restored.
 */
export function undoRun(
	db: Db,
	buildId: string,
	userId: string,
	runId: string,
	body: unknown
): void {
	if (!isObj(body) || !Array.isArray(body.parts)) bad('parts must be an array');
	const rawParts = body.parts as unknown[];
	if (rawParts.length > 100) bad('Too many parts');
	mutateBuild(db, buildId, userId, (tx, view) => {
		const r = tx
			.select()
			.from(printRuns)
			.where(and(eq(printRuns.id, runId), eq(printRuns.buildId, buildId)))
			.get();
		if (!r) throw new ApiError(404, 'Run not found');
		const allowed = runTargets(view, {
			plateNumber: r.plateNumber,
			partSlug: r.partSlug,
			partSlugs: r.partSlugs,
			date: r.date,
			result: r.result as PrintRunInput['result'],
			grams: r.grams,
			hours: r.hours,
			printer: r.printer,
			note: r.note
		});
		const patches: PartPatch[] = [];
		for (const raw of rawParts) {
			if (!isObj(raw) || typeof raw.slug !== 'string') bad('Invalid part snapshot');
			const slug = raw.slug;
			if (!allowed.includes(slug) || !view.state[slug]) bad('Part is not affected by this run');
			if (!(PART_STATUSES as readonly unknown[]).includes(raw.status)) bad('Invalid status');
			const startedAt = raw.startedAt ?? null;
			if (
				startedAt !== null &&
				(typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt)))
			)
				bad('Invalid startedAt');
			const printedOn = raw.printedOn ?? null;
			if (printedOn !== null) dateStr(printedOn, 'printedOn');
			const runEstSeconds = optNum(raw.runEstSeconds, 'runEstSeconds') ?? null;
			if (!isObj(raw.comps)) bad('comps must be an object');
			const comps: Record<string, boolean> = {};
			for (const [k, v] of Object.entries(raw.comps)) {
				if (typeof v !== 'boolean') bad('comps values must be booleans');
				comps[k] = v;
			}
			patches.push({
				slug,
				status: raw.status as PartStatus,
				startedAt: startedAt as string | null,
				printedOn: printedOn as string | null,
				runEstSeconds,
				comps
			});
		}
		tx.delete(printRuns).where(eq(printRuns.id, runId)).run();
		return {
			kind: 'run.undo',
			payload: {
				runId,
				plateNumber: r.plateNumber,
				partSlug: r.partSlug,
				partSlugs: r.partSlugs,
				result: r.result
			},
			patches
		};
	});
}

/**
 * Move a build from the owner's personal workspace into a chapter. Owner of the
 * source (the personal workspace) and editor or owner of the target chapter.
 */
export function moveBuild(db: Db, buildId: string, userId: string, body: unknown): void {
	if (!isObj(body) || typeof body.organizationId !== 'string' || !body.organizationId)
		bad('organizationId is required');
	const targetId = body.organizationId as string;
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	requireOwner(db, access.organizationId, userId);
	requireEditor(db, targetId, userId);
	if (targetId === access.organizationId) bad('The build is already there');
	if (!isPersonalOrg(db, access.organizationId))
		bad('Only builds in My builds can be moved to a chapter');
	if (isPersonalOrg(db, targetId)) bad('Pick a chapter to move the build to');
	const now = new Date();
	const target = db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, targetId))
		.get();
	db.transaction((tx) => {
		tx.update(builds).set({ organizationId: targetId }).where(eq(builds.id, buildId)).run();
		tx.insert(activity)
			.values({
				buildId,
				userId,
				kind: 'build.move',
				payload: { from: access.organizationId, to: targetId, toName: target?.name ?? null },
				at: now
			})
			.run();
	});
	publish(db, buildId, userId, 'build.move', now);
}
