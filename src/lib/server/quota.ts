/**
 * Quota enforcement: the one place that turns the limits of `quotas()` (config.ts) into refusals.
 *
 * Contract (shared by every creation path; keep it small):
 * - `assertUnder(tx, key, count, ctx)`: call INSIDE the same synchronous `db.transaction` that
 *   inserts the row, with no await between the count and the insert, so two parallel requests
 *   cannot both pass. A `null` limit returns at once without running `count`. Site admins are
 *   exempt (only looked up once the count has reached the limit). Refusal throws `QuotaError`
 *   (an `ApiError`, status 409, `code: 'quota'`), which `respond()` renders as
 *   `{ error: <sentence>, code: 'quota' }` and page actions as `fail(409, { error })`.
 * - `count` is `() => number` (or a number): use the `count*` helpers below, or your own query.
 * - Bytes: `assertUploadRoom(tx, orgId, addBytes, ctx)` and `workspaceUploadBytes(db, orgId)`.
 *   Sizes come from the files on disk (stat of the paths the database rows point at), never from
 *   anything the client declared. For a file already streamed to disk but not yet in the
 *   database, `enforceStreamedUpload(db, orgId, filePath, ctx)` checks it and deletes the file
 *   when it pushes the workspace over. Call it BEFORE inserting the row that references it.
 * - Live streams: `acquireSseSlot(db, user)` returns an idempotent `release()`; it throws a
 *   `QuotaError` with status 429 at the per-user cap.
 *
 * No route imports. Self-hosted installs have every limit `null`, so nothing here costs a query.
 *
 * Usage:
 *   db.transaction((tx) => {
 *     assertUnder(tx, 'buildsPerWorkspace', () => countBuilds(tx, orgId), { userId });
 *     tx.insert(builds).values({ ... }).run();
 *   });
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { and, eq, ne, sql } from 'drizzle-orm';
import { ApiError, isSiteAdmin } from './access';
import { quotas, uploadsDir, type Quotas } from './config';
import type { Db } from './db';
import { member, organization } from './db/auth.schema';
import {
	activity,
	buildPhotos,
	buildPlates,
	buildUploads,
	builds,
	colorDesigns,
	customFilaments,
	printRuns,
	user
} from './db/schema';
import { kitCopyBytes } from './templates/files';

export type QuotaKey = keyof Quotas;

/** Refusal for a reached limit: 409 (429 for live streams) with `code: 'quota'`. */
export class QuotaError extends ApiError {
	readonly code = 'quota';
	constructor(message: string, status = 409) {
		super(status, message);
	}
}

export interface QuotaContext {
	/** Who is asking (admins are exempt). */
	userId: string;
}

/** The configured limit for a key (`null` = unlimited). Read per call so the environment is honoured. */
export function quotaLimit(key: QuotaKey): number | null {
	return quotas()[key];
}

const TAIL = 'the limit on this server';

function sentence(key: QuotaKey, limit: number, current: number): string {
	const n = (count: number, one: string, many = one + 's') =>
		`${count} ${count === 1 ? one : many}`;
	if (limit === 0) {
		const none: Partial<Record<QuotaKey, string>> = {
			buildsPerWorkspace: 'Builds cannot be created in a workspace on this server.',
			draftsPerUser: 'Studio drafts cannot be created on this server.',
			photosPerBuild: 'Photos cannot be added to builds on this server.',
			customFilamentsPerWorkspace: 'Custom filaments cannot be added on this server.',
			savedDesignsPerUser: 'Designs cannot be saved on this server.',
			kitCopiesPerWorkspace: 'Kit copies cannot be made on this server.',
			chaptersPerUser: 'Chapters cannot be created on this server.',
			membersPerChapter: 'Members cannot be added to chapters on this server.',
			pendingInvitesPerChapter: 'Invitations cannot be sent on this server.',
			stepConversionsPerUser: 'Model conversions are not allowed on this server.',
			sseConnectionsPerUser: 'Live updates are not available on this server.',
			accountsTotal: 'Sign-up is closed on this server.',
			signupsPerDay: 'Sign-up is closed on this server.',
			membershipsPerUser: 'Joining chapters is not allowed on this server.',
			concurrentUploadsPerUser: 'Uploads are not allowed on this server.',
			uploadBytesPerWorkspace: 'Uploads are not allowed on this server.',
			uploadBytesPerUser: 'Uploads are not allowed on this server.'
		};
		return `${none[key] ?? 'This is not allowed on this server.'} Ask the admin.`;
	}
	switch (key) {
		case 'buildsPerWorkspace':
			return `This workspace already has ${n(current, 'build')}, ${TAIL}. Delete one or ask the admin.`;
		case 'draftsPerUser':
			return `You already have ${n(current, 'draft')}, ${TAIL}. Delete one or ask the admin.`;
		case 'photosPerBuild':
			return `This build already has ${n(current, 'photo')}, ${TAIL}. Delete one or ask the admin.`;
		case 'customFilamentsPerWorkspace':
			return `This workspace already has ${n(current, 'custom filament')}, ${TAIL}. Delete one or ask the admin.`;
		case 'savedDesignsPerUser':
			return `You already have ${n(current, 'saved design')}, ${TAIL}. Delete one or ask the admin.`;
		case 'uploadBytesPerWorkspace':
			return `This workspace has used its ${formatBytes(limit)} of upload space, ${TAIL}. Delete some photos or ask the admin.`;
		case 'uploadBytesPerUser':
			return `The workspaces you own have used your ${formatBytes(limit)} of upload space, ${TAIL}. Delete some photos or ask the admin.`;
		case 'kitCopiesPerWorkspace':
			return `This workspace already has ${n(current, 'kit copy', 'kit copies')}, ${TAIL}. Delete one or ask the admin.`;
		case 'chaptersPerUser':
			return `You already belong to ${n(current, 'chapter')} you created, ${TAIL}. Delete one or ask the admin.`;
		case 'membersPerChapter':
			return `This chapter already has ${n(current, 'member')}, ${TAIL}. Remove one or ask the admin.`;
		case 'pendingInvitesPerChapter':
			return `This chapter already has ${n(current, 'pending invitation')}, ${TAIL}. Cancel one or ask the admin.`;
		case 'stepConversionsPerUser':
			return `You already have ${n(current, 'model conversion')} queued or running, ${TAIL}. Wait for it to finish and try again.`;
		case 'accountsTotal':
			return `This server has reached its limit of ${n(limit, 'account')}. Ask the admin.`;
		case 'signupsPerDay':
			return `This server has reached its limit of ${n(limit, 'new account')} per day. Try again tomorrow.`;
		case 'membershipsPerUser':
			return `You already belong to ${n(current, 'chapter')}, ${TAIL}. Leave one or ask the admin.`;
		case 'concurrentUploadsPerUser':
			return `You already have ${n(current, 'upload')} in progress, ${TAIL}. Wait for it to finish and try again.`;
		case 'sseConnectionsPerUser':
			return `You already have ${n(current, 'live connection')} open, ${TAIL}. Close another tab and try again.`;
		default: {
			// Every Quotas key has a sentence above; a new key fails to compile here until it gets one.
			const missing: never = key;
			return `This has reached its limit (${limit}) for ${missing}, ${TAIL}. Ask the admin.`;
		}
	}
}

function formatBytes(b: number): string {
	if (b >= 1024 ** 3) return `${+(b / 1024 ** 3).toFixed(1)} GB`;
	return `${Math.max(1, Math.round(b / 1024 ** 2))} MB`;
}

function isExempt(db: Db, userId: string): boolean {
	const u = db
		.select({ id: user.id, email: user.email, emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.id, userId))
		.get();
	return !!u && isSiteAdmin(db, u);
}

/**
 * Refuse (QuotaError, 409) when `current` already is at the limit for `key`, i.e. one more would
 * pass it. `null` limit: returns without calling `count`. Admins pass.
 * Run it inside the transaction that inserts the row.
 */
export function assertUnder(
	tx: Db,
	key: Exclude<QuotaKey, 'uploadBytesPerWorkspace' | 'uploadBytesPerUser'>,
	count: number | (() => number),
	ctx: QuotaContext
): void {
	const limit = quotaLimit(key);
	if (limit === null) return;
	const current = typeof count === 'function' ? count() : count;
	if (current < limit) return;
	if (isExempt(tx, ctx.userId)) return;
	throw new QuotaError(sentence(key, limit, current));
}

// ---- row caps (constants, both modes)

/** Most print logs one build holds. Generous: a real build has dozens. */
export const MAX_RUNS_PER_BUILD = 2000;
/** Newest activity rows kept per build; older ones are deleted as new ones arrive. */
export const MAX_ACTIVITY_PER_BUILD = 5000;
const ACTIVITY_SLACK = 250;

/** Refuse (QuotaError, 409) when a build would hold more than `MAX_RUNS_PER_BUILD` runs. */
export function assertRunTotal(total: number): void {
	if (total <= MAX_RUNS_PER_BUILD) return;
	throw new QuotaError(
		`This build can hold at most ${MAX_RUNS_PER_BUILD} print logs. Delete old ones to add more.`
	);
}

/** One more run in this build: counts its runs (inside the inserting transaction) and refuses at the cap. */
export function assertRunRoom(tx: Db, buildId: string): void {
	const n =
		tx
			.select({ n: sql<number>`count(*)` })
			.from(printRuns)
			.where(eq(printRuns.buildId, buildId))
			.get()?.n ?? 0;
	assertRunTotal(n + 1);
}

/**
 * Keep only the newest `MAX_ACTIVITY_PER_BUILD` activity rows of a build. Call in the transaction
 * that inserts a row. The count is an indexed range read; the delete runs only once the build is
 * `ACTIVITY_SLACK` rows over, so it is rare and removes a batch.
 */
export function pruneActivity(tx: Db, buildId: string): void {
	const n =
		tx
			.select({ n: sql<number>`count(*)` })
			.from(activity)
			.where(eq(activity.buildId, buildId))
			.get()?.n ?? 0;
	if (n <= MAX_ACTIVITY_PER_BUILD + ACTIVITY_SLACK) return;
	tx.run(
		sql`delete from activity where build_id = ${buildId} and rowid in (
			select rowid from activity where build_id = ${buildId}
			order by at desc, rowid desc limit -1 offset ${MAX_ACTIVITY_PER_BUILD})`
	);
}

// ---- counting

/** Tracked builds (drafts excluded) in a workspace. */
export function countBuilds(db: Db, orgId: string): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(builds)
			.where(and(eq(builds.organizationId, orgId), ne(builds.kind, 'draft')))
			.get()?.n ?? 0
	);
}

/** Studio drafts a user created (in any workspace). */
export function countDrafts(db: Db, userId: string): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(builds)
			.where(and(eq(builds.createdBy, userId), eq(builds.kind, 'draft')))
			.get()?.n ?? 0
	);
}

export function countPhotos(db: Db, buildId: string): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(buildPhotos)
			.where(eq(buildPhotos.buildId, buildId))
			.get()?.n ?? 0
	);
}

export function countCustomFilaments(db: Db, orgId: string): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(customFilaments)
			.where(eq(customFilaments.organizationId, orgId))
			.get()?.n ?? 0
	);
}

export function countSavedDesigns(db: Db, userId: string): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(colorDesigns)
			.where(eq(colorDesigns.authorUserId, userId))
			.get()?.n ?? 0
	);
}

// ---- bytes

function sizeOf(rel: string): number {
	try {
		const p = isAbsolute(rel) ? rel : join(uploadsDir(), rel);
		return statSync(p).size;
	} catch {
		return 0;
	}
}

/** The personal workspace of a user (organization flagged `personal` for them), if any. */
function personalOrgId(db: Db, userId: string): string | null {
	const rows = db
		.select({ id: organization.id, metadata: organization.metadata })
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(eq(member.userId, userId))
		.all();
	for (const r of rows) {
		try {
			const m = JSON.parse(r.metadata ?? '{}') as { personal?: unknown; userId?: unknown };
			if (m.personal === true && m.userId === userId) return r.id;
		} catch {
			/* not JSON */
		}
	}
	return null;
}

/**
 * Bytes of uploaded files a workspace holds, from the files on disk behind the database rows:
 * photos (and thumbnails) of its builds, plate thumbnails, the kit files of its kit copies, plus the design snapshots its owner authored when it is
 * a personal workspace (a design belongs to a person, not a chapter). Other agents add their own
 * kinds of upload here when they enforce them.
 */
export function workspaceUploadBytes(db: Db, orgId: string): number {
	let total = 0;
	const photos = db
		.select({ path: buildPhotos.path, thumb: buildPhotos.thumbPath })
		.from(buildPhotos)
		.innerJoin(builds, eq(builds.id, buildPhotos.buildId))
		.where(eq(builds.organizationId, orgId))
		.all();
	for (const p of photos) total += sizeOf(p.path) + (p.thumb ? sizeOf(p.thumb) : 0);

	total += plateFileBytes(db, orgId);
	total += kitCopyBytes(db, orgId);

	const org = db
		.select({ metadata: organization.metadata })
		.from(organization)
		.where(eq(organization.id, orgId))
		.get();
	try {
		const m = JSON.parse(org?.metadata ?? '{}') as { personal?: unknown; userId?: unknown };
		if (m.personal === true && typeof m.userId === 'string') total += snapshotBytes(db, m.userId);
	} catch {
		/* not JSON */
	}
	return total;
}

function dirBytes(dir: string): number {
	let total = 0;
	try {
		for (const f of readdirSync(dir)) total += sizeOf(join(dir, f));
	} catch {
		/* missing directory */
	}
	return total;
}

/**
 * Bytes a parsed (not yet applied) 3MF upload keeps on disk: its plate thumbnails under
 * `3mf/<uploadId>/`. The 3MF itself is deleted right after parsing and never counts.
 */
export function parsedUploadBytes(uploadId: string): number {
	return dirBytes(join(uploadsDir(), '3mf', uploadId));
}

/**
 * Plate files a workspace keeps: the plate thumbnails of its builds (`build_plates.thumbnail_path`)
 * and the thumbnails of its parsed-but-unapplied 3MF uploads.
 */
function plateFileBytes(db: Db, orgId: string): number {
	let total = 0;
	const thumbs = db
		.select({ path: buildPlates.thumbnailPath })
		.from(buildPlates)
		.innerJoin(builds, eq(builds.id, buildPlates.buildId))
		.where(eq(builds.organizationId, orgId))
		.all();
	for (const t of thumbs) if (t.path) total += sizeOf(t.path);
	const pending = db
		.select({ id: buildUploads.id })
		.from(buildUploads)
		.innerJoin(builds, eq(builds.id, buildUploads.buildId))
		.where(and(eq(builds.organizationId, orgId), eq(buildUploads.status, 'parsed')))
		.all();
	for (const u of pending) total += parsedUploadBytes(u.id);
	return total;
}

function snapshotBytes(db: Db, authorId: string): number {
	const ids = db
		.select({ id: colorDesigns.id })
		.from(colorDesigns)
		.where(eq(colorDesigns.authorUserId, authorId))
		.all()
		.map((r) => r.id);
	let total = 0;
	for (const id of ids) total += sizeOf(`designs/${id}.png`);
	return total;
}

/**
 * Refuse (QuotaError, 409) when a workspace holding its current bytes plus `addBytes` would pass
 * `uploadBytesPerWorkspace`. `addBytes = 0` is the "already over?" check before streaming.
 * `null` limit: returns with no query. Admins pass.
 */
export function assertUploadRoom(tx: Db, orgId: string, addBytes: number, ctx: QuotaContext): void {
	const wsLimit = quotaLimit('uploadBytesPerWorkspace');
	const userLimit = quotaLimit('uploadBytesPerUser');
	if (wsLimit === null && userLimit === null) return;
	const fits = (current: number, limit: number) =>
		addBytes === 0 ? current < limit : current + addBytes <= limit;
	let refusal: string | null = null;
	if (wsLimit !== null) {
		const current = workspaceUploadBytes(tx, orgId);
		if (!fits(current, wsLimit)) refusal = sentence('uploadBytesPerWorkspace', wsLimit, current);
	}
	if (refusal === null && userLimit !== null) {
		const current = userUploadBytes(tx, ctx.userId, orgId);
		if (current !== null && !fits(current, userLimit))
			refusal = sentence('uploadBytesPerUser', userLimit, current);
	}
	if (refusal === null || isExempt(tx, ctx.userId)) return;
	throw new QuotaError(refusal);
}

/**
 * Bytes held across the workspaces a user owns (their personal workspace plus every chapter
 * where they are an owner). `null` when `orgId` is not one of them: an editor uploading into
 * someone else's chapter is limited by that chapter's own limit only.
 */
export function userUploadBytes(db: Db, userId: string, orgId: string): number | null {
	const ids = new Set<string>();
	const personal = personalOrgId(db, userId);
	if (personal) ids.add(personal);
	for (const r of db
		.select({ org: member.organizationId, role: member.role })
		.from(member)
		.where(eq(member.userId, userId))
		.all())
		if (r.role.split(',').some((x) => x.trim() === 'owner')) ids.add(r.org);
	if (!ids.has(orgId)) return null;
	let total = 0;
	for (const id of ids) total += workspaceUploadBytes(db, id);
	return total;
}

/** The personal workspace a design snapshot is charged to, `null` when the author has none. */
export function snapshotWorkspace(db: Db, authorId: string): string | null {
	return personalOrgId(db, authorId);
}

/**
 * For an upload already streamed to `filePath` but not yet referenced by a database row: if it
 * pushes the workspace over, delete the file and refuse. Call before inserting the row.
 */
export async function enforceStreamedUpload(
	db: Db,
	orgId: string,
	filePath: string,
	ctx: QuotaContext
): Promise<void> {
	if (quotaLimit('uploadBytesPerWorkspace') === null && quotaLimit('uploadBytesPerUser') === null)
		return;
	if (!existsSync(filePath)) return;
	try {
		assertUploadRoom(db, orgId, statSync(filePath).size, ctx);
	} catch (e) {
		await rm(filePath, { force: true }).catch(() => {});
		throw e;
	}
}

// ---- live-stream slots

const SSE_KEY = Symbol.for('tmt.sse-slots');
const UPLOAD_KEY = Symbol.for('tmt.upload-slots');
type G = typeof globalThis & { [k: symbol]: Map<string, number> | undefined };
const slotMap = (k: symbol) => ((globalThis as G)[k] ??= new Map<string, number>());
const slots = slotMap(SSE_KEY);
const uploadSlots = slotMap(UPLOAD_KEY);

/** Open live connections a user holds right now (tests, diagnostics). */
export function openSseSlots(userId: string): number {
	return slots.get(userId) ?? 0;
}

/** Uploads a user has in progress right now (tests, diagnostics). */
export function openUploadSlots(userId: string): number {
	return uploadSlots.get(userId) ?? 0;
}

export interface SseUser {
	id: string;
	email?: string | null;
	emailVerified?: boolean | null;
}

function acquireSlot(
	db: Db,
	u: SseUser,
	key: 'sseConnectionsPerUser' | 'concurrentUploadsPerUser',
	map: Map<string, number>
): () => void {
	const limit = quotaLimit(key);
	if (limit !== null) {
		const current = map.get(u.id) ?? 0;
		if (current >= limit && !isSiteAdmin(db, u))
			throw new QuotaError(sentence(key, limit, current), 429);
	}
	map.set(u.id, (map.get(u.id) ?? 0) + 1);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const left = (map.get(u.id) ?? 1) - 1;
		if (left <= 0) map.delete(u.id);
		else map.set(u.id, left);
	};
}

/**
 * Take one live-connection slot for the user, or throw QuotaError (429). Returns `release()`,
 * safe to call any number of times; call it when the stream closes, cancels or aborts.
 */
export function acquireSseSlot(db: Db, u: SseUser): () => void {
	return acquireSlot(db, u, 'sseConnectionsPerUser', slots);
}

/**
 * Take one concurrent-upload slot for the user, or throw QuotaError (429, `code: 'quota'`).
 * Returns an idempotent `release()`: call it in a `finally` around the whole upload so success,
 * error and client abort all free the slot exactly once. `null` limit: counts but never refuses.
 */
export function acquireUploadSlot(db: Db, u: SseUser): () => void {
	return acquireSlot(db, u, 'concurrentUploadsPerUser', uploadSlots);
}
