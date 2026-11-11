import { and, eq } from 'drizzle-orm';
import {
	convertPrototype,
	importCounts,
	PROTOTYPE_FORMAT,
	type ImportCounts,
	type PrototypeConversion,
	type PrototypeExport
} from '#lib/domain/import-prototype.ts';
import type { BuildView } from '#lib/domain/types.ts';
import { ApiError, buildAccess } from '../access';
import type { Db } from '../db';
import {
	activity,
	buildFilaments,
	buildParts,
	buildPlates,
	builds,
	member,
	printRuns,
	user
} from '../db/schema';
import { emitBuildEvent } from '../events';
import { assertRunTotal } from '../quota';
import { applyPatches, loadBuildView } from './view';

export interface ImportPreview extends ImportCounts {
	warnings: string[];
	/** True when the build has no runs and every part is still 'To print'. */
	empty: boolean;
}
export interface ImportResult extends ImportPreview {
	replaced: boolean;
}

/**
 * Load the build view for an import. With a user id the usual access rules apply
 * (404 non-member, 403 viewer). With null (the CLI, run by whoever administers the
 * server) no check is made and the view is read as the workspace owner.
 */
function loadForImport(db: Db, buildId: string, userId: string | null): BuildView {
	let viewer = userId;
	if (userId) {
		const access = buildAccess(db, buildId, userId);
		if (!access) throw new ApiError(404, 'Not found');
		if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	} else {
		const b = db
			.select({ org: builds.organizationId })
			.from(builds)
			.where(eq(builds.id, buildId))
			.get();
		if (!b) throw new ApiError(404, 'Build not found');
		const members = db
			.select({ userId: member.userId, role: member.role })
			.from(member)
			.where(eq(member.organizationId, b.org))
			.all();
		viewer =
			(members.find((m) => m.role.split(',')[0].trim() === 'owner') ?? members[0])?.userId ?? null;
		if (!viewer) throw new ApiError(400, 'The build workspace has no members');
	}
	const view = loadBuildView(db, buildId, viewer!);
	if (!view) throw new ApiError(404, 'Not found');
	return view;
}

function isEmpty(view: BuildView): boolean {
	return view.runs.length === 0 && Object.values(view.state).every((s) => s.status === 'To print');
}

function convert(view: BuildView, data: unknown): PrototypeConversion {
	let c: PrototypeConversion;
	try {
		c = convertPrototype(view, data as PrototypeExport);
	} catch (e) {
		throw new ApiError(400, e instanceof Error ? e.message : 'Invalid export');
	}
	// An import replaces or fills an empty build, so its runs are the build's whole run count.
	assertRunTotal(c.runs.length);
	return c;
}

/** Dry run: what an import would do. Writes nothing. */
export function previewPrototype(
	db: Db,
	buildId: string,
	userId: string | null,
	data: unknown
): ImportPreview {
	const view = loadForImport(db, buildId, userId);
	const c = convert(view, data);
	return { ...importCounts(c), warnings: c.warnings, empty: isEmpty(view) };
}

/**
 * Import progress from the original prototype into a build, in one transaction.
 * Refuses (409) unless the build is empty, or `replace` is set, which first
 * deletes the build's runs and resets all parts.
 */
export function importPrototype(
	db: Db,
	buildId: string,
	userId: string | null,
	data: unknown,
	opts: { replace?: boolean } = {}
): ImportResult {
	const view = loadForImport(db, buildId, userId);
	const empty = isEmpty(view);
	if (!empty && !opts.replace)
		throw new ApiError(
			409,
			'This build already has progress. Import with "replace" to overwrite it.'
		);
	const c = convert(view, data);
	const now = new Date();
	const counts = importCounts(c);

	db.transaction((txRaw) => {
		const tx = txRaw as unknown as Db;
		if (!empty) {
			tx.delete(printRuns).where(eq(printRuns.buildId, buildId)).run();
			tx.update(buildParts)
				.set({
					status: 'To print',
					startedAt: null,
					printedOn: null,
					runEstSeconds: null,
					comps: {},
					updatedAt: now
				})
				.where(eq(buildParts.buildId, buildId))
				.run();
		}
		applyPatches(tx, buildId, c.patches, now);
		for (const r of c.runs)
			tx.insert(printRuns)
				.values({
					buildId,
					plateNumber: r.plateNumber,
					partSlug: r.partSlug,
					partSlugs: r.partSlugs,
					date: r.date,
					result: r.result,
					grams: r.grams,
					hours: r.hours,
					printer: r.printer,
					userId,
					note: r.note
				})
				.run();
		for (const p of c.plates)
			tx.update(buildPlates)
				.set({ slicerGrams: p.slicerGrams, slicerByPart: p.slicerByPart })
				.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.number, p.number)))
				.run();
		for (const s of c.spools)
			tx.update(buildFilaments)
				.set({ spools: s.spools })
				.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, s.role)))
				.run();
		tx.insert(activity)
			.values({
				buildId,
				userId,
				kind: 'build.import',
				payload: {
					format: PROTOTYPE_FORMAT,
					...counts,
					replaced: !empty,
					warnings: c.warnings.length
				},
				at: now
			})
			.run();
	});

	const u = userId
		? db.select({ name: user.name }).from(user).where(eq(user.id, userId)).get()
		: null;
	emitBuildEvent(buildId, {
		type: 'changed',
		kind: 'build.import',
		by: u?.name ?? null,
		at: now.toISOString()
	});
	return { ...counts, warnings: c.warnings, empty, replaced: !empty };
}
