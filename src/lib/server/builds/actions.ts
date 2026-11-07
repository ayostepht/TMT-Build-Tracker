import { and, eq } from 'drizzle-orm';
import {
	applyRun,
	recomputeParts,
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
	type BuildPrinter,
	type BuildView,
	type PartPatch,
	type PartStatus,
	type PrintRun,
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
import { parsePrinter } from '#lib/printers/printer.ts';
import { isPersonalOrg } from '../teams';
import { autoRearrangeBuild, REARRANGE_KINDS } from './arrange-plan';
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
 * Activity kinds a Studio draft may produce. Everything else (runs, part status, printing,
 * assembly, handoff, photos, spools, imports) is build tracking and is refused with a 400.
 */
const DRAFT_KINDS = new Set([
	'build.update',
	'build.variant',
	'build.printer',
	'build.template',
	'build.move',
	'build.promote',
	'filament.update',
	'plate.slicer'
]);
export function draftAllows(kind: string): boolean {
	return DRAFT_KINDS.has(kind) || kind.startsWith('design.') || kind.startsWith('plates.');
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
		if (access.kind === 'draft' && !draftAllows(o.kind))
			throw new ApiError(400, 'Drafts have no build tracking. Make it a build first.');
		if (o.patches?.length) applyPatches(tx, buildId, o.patches, now);
		if (REARRANGE_KINDS.has(o.kind)) autoRearrangeBuild(tx, buildId, userId);
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
	mutateBuild(db, buildId, userId, (tx, view) => {
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
			if (view.build.kind === 'draft') bad('Drafts have no phase');
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
	// A draft is a sandbox: editors may delete it. A real build needs a chapter owner.
	if (access.kind === 'draft') requireEditor(db, access.organizationId, userId);
	else requireOwner(db, access.organizationId, userId);
	db.delete(builds).where(eq(builds.id, buildId)).run();
	publish(db, buildId, userId, 'build.delete', new Date());
}

/**
 * Studio draft to tracked build: keeps the design, variants, printer, plates and uploaded
 * files. Setup counts as done up to the Export step (everything it asks for exists already), so
 * the wizard opens there with every earlier step one click away.
 * Editors and owners. Writes a `build.promote` activity row.
 */
export function promoteDraft(db: Db, buildId: string, userId: string): void {
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	if (access.kind !== 'draft') throw new ApiError(400, 'This is already a build');
	mutateBuild(db, buildId, userId, (tx) => {
		tx.update(builds).set({ kind: 'build', setupStep: 5 }).where(eq(builds.id, buildId)).run();
		return { kind: 'build.promote', payload: {} };
	});
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
		const o = runOutcome(tx, view, now, buildId, userId, body);
		runId = o.runId;
		return o.outcome;
	});
	return runId;
}

function runOutcome(
	tx: Db,
	view: BuildView,
	now: Date,
	buildId: string,
	userId: string | null,
	body: Obj
): { runId: string; outcome: Outcome } {
	{
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
		const runId = row.id;
		return {
			runId,
			outcome: {
				kind: 'run.add',
				payload: {
					runId,
					plateNumber,
					partSlug,
					partSlugs,
					grams: input.grams,
					result: input.result,
					...(userId === null ? { auto: true } : {})
				},
				patches: applyRun(view, input, now)
			}
		};
	}
}

export function deleteRun(
	db: Db,
	buildId: string,
	userId: string,
	runId: string,
	opts: { recompute?: boolean } = {}
): void {
	mutateBuild(db, buildId, userId, (tx, view) => {
		const r = tx
			.select()
			.from(printRuns)
			.where(and(eq(printRuns.id, runId), eq(printRuns.buildId, buildId)))
			.get();
		if (!r) throw new ApiError(404, 'Run not found');
		tx.delete(printRuns).where(eq(printRuns.id, runId)).run();
		const patches =
			opts.recompute === false
				? []
				: recomputeParts(
						view,
						view.runs.filter((x) => x.id !== runId),
						runTargets(view, runFromRow(r))
					);
		return {
			kind: 'run.delete',
			payload: {
				runId,
				plateNumber: r.plateNumber,
				partSlug: r.partSlug,
				result: r.result,
				recomputed: recomputedList(view, patches)
			},
			patches
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
				!Number.isFinite(body.spools) ||
				body.spools < 0 ||
				body.spools > 99
			)
				bad('spools must be a number from 0 to 99');
			set.spools = Math.round(body.spools * 100) / 100;
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

type RunRow = typeof printRuns.$inferSelect;

function runFromRow(r: RunRow): PrintRun {
	return {
		id: r.id,
		plateNumber: r.plateNumber,
		partSlug: r.partSlug,
		partSlugs: r.partSlugs ?? null,
		date: r.date,
		result: r.result as PrintRun['result'],
		grams: r.grams,
		hours: r.hours,
		printer: r.printer,
		userId: r.userId,
		userName: null,
		note: r.note
	};
}

/** `[{ slug, from, to }]` for the patches that change a part's status (activity payload). */
function recomputedList(view: BuildView, patches: PartPatch[]) {
	return patches
		.filter((p) => p.status !== undefined && p.status !== view.state[p.slug]?.status)
		.map((p) => ({ slug: p.slug, from: view.state[p.slug].status, to: p.status as PartStatus }));
}

/**
 * Correct a past print log. Changing result, part or date re-derives the status of the
 * parts the run (before and after the edit) targets; grams, hours and note never do.
 */
export function updateRun(
	db: Db,
	buildId: string,
	userId: string,
	runId: string,
	body: unknown
): void {
	if (!isObj(body)) bad('Invalid body');
	mutateBuild(db, buildId, userId, (tx, view) => {
		const row = tx
			.select()
			.from(printRuns)
			.where(and(eq(printRuns.id, runId), eq(printRuns.buildId, buildId)))
			.get();
		if (!row) throw new ApiError(404, 'Run not found');
		const old = runFromRow(row);
		const set: Partial<typeof printRuns.$inferInsert> = {};
		const changed: Obj = {};
		if (body.date !== undefined) {
			set.date = dateStr(body.date, 'date');
			changed.date = set.date;
		}
		if (body.result !== undefined) {
			if (!(RUN_RESULTS as readonly unknown[]).includes(body.result)) bad('Unknown result');
			set.result = body.result as string;
			changed.result = set.result;
		}
		if (body.grams !== undefined) {
			set.grams = optNum(body.grams, 'grams') ?? null;
			changed.grams = set.grams;
		}
		if (body.hours !== undefined) {
			set.hours = optNum(body.hours, 'hours') ?? null;
			changed.hours = set.hours;
		}
		if (body.note !== undefined) {
			if (typeof body.note !== 'string') bad('note must be a string');
			set.note = body.note.slice(0, 2000);
			changed.note = true;
		}
		if (body.partSlug !== undefined) {
			const s = optStr(body.partSlug, 'partSlug') ?? null;
			if (s && !view.state[s]) bad('Unknown part');
			if (s === null && old.plateNumber === null) bad('A part log needs a part');
			const pl =
				old.plateNumber === null ? null : view.plates.find((x) => x.number === old.plateNumber);
			if (s && pl && !pl.parts.includes(s)) bad('Part is not on this plate');
			set.partSlug = s;
			changed.newPartSlug = s;
		}
		if (!Object.keys(set).length) bad('Nothing to update');
		tx.update(printRuns).set(set).where(eq(printRuns.id, runId)).run();

		const next: PrintRun = { ...old, ...(set as Partial<PrintRun>) };
		let patches: PartPatch[] = [];
		if ('result' in set || 'partSlug' in set || 'date' in set) {
			const runs = view.runs
				.map((r) => (r.id === runId ? { ...next, userName: r.userName } : r))
				.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
			const slugs = [...new Set([...runTargets(view, old), ...runTargets(view, next)])];
			patches = recomputeParts(view, runs, slugs);
		}
		return {
			kind: 'run.update',
			payload: {
				runId,
				plateNumber: next.plateNumber,
				partSlug: next.partSlug,
				partSlugs: next.partSlugs,
				...changed,
				recomputed: recomputedList(view, patches)
			},
			patches
		};
	});
}

/**
 * Switch a build's choice for one variant group. Progress rows of the options not
 * chosen stay in the database, so switching back restores them.
 */
export function setVariant(db: Db, buildId: string, userId: string, body: unknown): void {
	if (!isObj(body) || typeof body.group !== 'string' || typeof body.option !== 'string')
		bad('group and option are required');
	const { group, option } = body as { group: string; option: string };
	mutateBuild(db, buildId, userId, (tx, view) => {
		const g = view.variantGroups.find((x) => x.key === group);
		if (!g) bad('Unknown variant group');
		const o = g.options.find((x) => x.key === option);
		if (!o) bad('Unknown option');
		const from = view.variantChoices[group];
		if (from === option) bad('Already selected');
		const choices = { ...view.variantChoices, [group]: option };
		tx.update(builds).set({ variantChoices: choices }).where(eq(builds.id, buildId)).run();
		return {
			kind: 'build.variant',
			payload: { group, groupName: g.name, from, to: option, toName: o.name }
		};
	});
}

/**
 * Set (or clear with `null`) the printer a build is planned for: `{ printer: BuildPrinter | null }`.
 * Editors and owners. Arranged plates are re-arranged for the new bed by `mutateBuild`
 * unless print logs hang on plates.
 */
export function setPrinter(db: Db, buildId: string, userId: string, body: unknown): void {
	if (!isObj(body) || !('printer' in body))
		bad('printer is required (an object, or null to clear)');
	let printer: BuildPrinter | null = null;
	if (body.printer !== null) {
		try {
			printer = parsePrinter(body.printer);
		} catch (e) {
			bad((e as Error).message);
		}
	}
	mutateBuild(db, buildId, userId, (tx) => {
		tx.update(builds).set({ printer }).where(eq(builds.id, buildId)).run();
		return {
			kind: 'build.printer',
			payload: printer
				? { name: printer.name, bedX: printer.bedX, bedY: printer.bedY, mmSlots: printer.mmSlots }
				: { name: null }
		};
	});
}

// ---- Milestone 7: printer jobs and Spoolman (appended)

/**
 * Like `mutateBuild` for changes the server makes on its own (a printer finished a job):
 * no permission check, the activity row has no user. `viewAs` is any member of the team and
 * is only used to load the view. `payload.by` names the source for the activity sentence.
 */
export function mutateBuildSystem(
	db: Db,
	buildId: string,
	viewAs: string,
	by: string,
	fn: (tx: Db, view: BuildView, now: Date) => Outcome
): Outcome {
	const now = new Date();
	const out = db.transaction((txRaw) => {
		const tx = txRaw as unknown as Db;
		const view = loadBuildView(tx, buildId, viewAs);
		if (!view) throw new ApiError(404, 'Not found');
		const o = fn(tx, view, now);
		if (view.build.kind === 'draft' && !draftAllows(o.kind))
			throw new ApiError(400, 'Drafts have no build tracking. Make it a build first.');
		if (o.patches?.length) applyPatches(tx, buildId, o.patches, now);
		if (REARRANGE_KINDS.has(o.kind)) autoRearrangeBuild(tx, buildId, viewAs);
		tx.insert(activity)
			.values({
				buildId,
				userId: null,
				kind: o.kind,
				payload: { ...(o.payload ?? {}), by },
				at: now
			})
			.run();
		return o;
	});
	emitBuildEvent(buildId, { type: 'changed', kind: out.kind, by, at: now.toISOString() });
	return out;
}

/** Log a run on behalf of a printer (auto-log of a finished job). Returns the run id. */
export function addRunSystem(
	db: Db,
	buildId: string,
	viewAs: string,
	by: string,
	body: Obj
): string {
	let runId = '';
	mutateBuildSystem(db, buildId, viewAs, by, (tx, view, now) => {
		const o = runOutcome(tx, view, now, buildId, null, body);
		runId = o.runId;
		return o.outcome;
	});
	return runId;
}

/** Link (or clear with null) a build filament slot to a Spoolman spool: `{ spoolId: number | null }`. */
export function linkSpool(
	db: Db,
	buildId: string,
	userId: string,
	role: string,
	body: unknown
): void {
	if (!isObj(body) || !('spoolId' in body))
		bad('spoolId is required (a number, or null to unlink)');
	const id = body.spoolId;
	if (id !== null && (typeof id !== 'number' || !Number.isInteger(id) || id < 1))
		bad('spoolId must be a whole number');
	const name = optStr(body.spoolName, 'spoolName', 200) ?? null;
	mutateBuild(db, buildId, userId, (tx, view) => {
		if (!view.filaments.some((f) => f.key === role)) throw new ApiError(404, 'Unknown filament');
		tx.update(buildFilaments)
			.set({ spoolmanSpoolId: id as number | null })
			.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
			.run();
		return { kind: 'filament.spool', payload: { role, spoolId: id, spoolName: name } };
	});
}

/** Setup wizard progress: the step (1 to 5) the build is on, or null once setup is finished. No activity row. */
export function setSetupStep(db: Db, buildId: string, userId: string, body: unknown): void {
	if (!isObj(body)) bad('Invalid body');
	const step = body.step;
	if (step !== null && !(Number.isInteger(step) && (step as number) >= 1 && (step as number) <= 5))
		bad('step must be 1 to 5, or null');
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	if (access.kind === 'draft') throw new ApiError(400, 'Drafts have no setup steps.');
	db.update(builds)
		.set({ setupStep: step as number | null })
		.where(eq(builds.id, buildId))
		.run();
	emitBuildEvent(buildId, {
		type: 'changed',
		kind: 'build.setup',
		by: null,
		at: new Date().toISOString()
	});
}
