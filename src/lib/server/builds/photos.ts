import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { PHOTO_KINDS, type PhotoKind } from '#lib/domain/types.ts';
import { ApiError, buildAccess } from '../access';
import { diskHasRoom, uploadsDir } from '../config';
import type { Db } from '../db';
import { buildPhotos } from '../db/schema';
import { extensionOf, sniffImage, stripImageMetadata, type ImageType } from '../images';
import { assertUnder, assertUploadRoom, countPhotos } from '../quota';
import { mutateBuild } from './actions';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_THUMB_BYTES = 1024 * 1024;

export interface PhotoInput {
	kind: unknown;
	caption?: unknown;
	width?: unknown;
	height?: unknown;
	file: Uint8Array;
	thumb?: Uint8Array | null;
}

function dim(v: unknown): number | null {
	const n = typeof v === 'string' ? Number(v) : v;
	return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 30000 ? n : null;
}

function checked(
	bytes: Uint8Array,
	max: number,
	what: string
): { bytes: Uint8Array; type: ImageType } {
	if (bytes.length === 0) throw new ApiError(400, `The ${what} is empty`);
	if (bytes.length > max)
		throw new ApiError(413, `The ${what} is larger than ${Math.round(max / 1e6)} MB`);
	const type = sniffImage(bytes);
	if (!type) throw new ApiError(400, `The ${what} must be a JPEG, PNG or WebP image`);
	return { bytes: stripImageMetadata(bytes, type), type };
}

/** Absolute path for a stored (relative) photo path; refuses anything outside the uploads dir. */
function absolute(rel: string): string {
	const root = resolve(uploadsDir());
	const p = resolve(root, rel);
	if (!p.startsWith(root + sep)) throw new ApiError(404, 'Not found');
	return p;
}

/** Store a photo (editor or owner): metadata stripped, files under `<uploads>/photos/<buildId>/`. Returns the photo id. */
export async function addPhoto(
	db: Db,
	buildId: string,
	userId: string,
	input: PhotoInput
): Promise<string> {
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	if (typeof input.kind !== 'string' || !(PHOTO_KINDS as readonly string[]).includes(input.kind))
		throw new ApiError(400, 'Unknown photo kind');
	const kind = input.kind as PhotoKind;
	const caption = typeof input.caption === 'string' ? input.caption.trim().slice(0, 300) : '';
	const full = checked(input.file, MAX_PHOTO_BYTES, 'photo');
	const thumb = input.thumb ? checked(input.thumb, MAX_THUMB_BYTES, 'thumbnail') : null;

	// Quota, from the bytes we will actually store (never the client's declared size). Checked up
	// front so an over-limit upload writes nothing, and again inside the insert transaction.
	const addBytes = full.bytes.length + (thumb?.bytes.length ?? 0);
	if (!diskHasRoom()) throw new ApiError(507, 'The server is almost out of disk space');
	db.transaction((tx) => {
		assertUnder(tx, 'photosPerBuild', () => countPhotos(tx, buildId), { userId });
		assertUploadRoom(tx, access.organizationId, addBytes, { userId });
	});

	const id = randomUUID();
	const path = `photos/${buildId}/${id}.${extensionOf(full.type)}`;
	const thumbPath = thumb ? `photos/${buildId}/${id}-thumb.${extensionOf(thumb.type)}` : null;
	await mkdir(dirname(absolute(path)), { recursive: true });
	await writeFile(absolute(path), full.bytes);
	if (thumb && thumbPath) await writeFile(absolute(thumbPath), thumb.bytes);
	try {
		mutateBuild(db, buildId, userId, (tx, _view, now) => {
			// Re-check in the same transaction as the insert (the files are not counted until the row exists).
			assertUnder(tx, 'photosPerBuild', () => countPhotos(tx, buildId), { userId });
			assertUploadRoom(tx, access.organizationId, addBytes, { userId });
			tx.insert(buildPhotos)
				.values({
					id,
					buildId,
					kind,
					path,
					thumbPath,
					caption,
					width: dim(input.width),
					height: dim(input.height),
					createdBy: userId,
					createdAt: now
				})
				.run();
			return { kind: 'photo.add', payload: { photoId: id, photoKind: kind } };
		});
	} catch (e) {
		await rm(absolute(path), { force: true });
		if (thumbPath) await rm(absolute(thumbPath), { force: true });
		throw e;
	}
	return id;
}

/** Delete a photo and its files (editor or owner). */
export async function deletePhoto(
	db: Db,
	buildId: string,
	userId: string,
	photoId: string
): Promise<void> {
	let files: string[] = [];
	mutateBuild(db, buildId, userId, (tx) => {
		const where = and(eq(buildPhotos.buildId, buildId), eq(buildPhotos.id, photoId));
		const row = tx.select().from(buildPhotos).where(where).get();
		if (!row) throw new ApiError(404, 'Not found');
		tx.delete(buildPhotos).where(where).run();
		files = [row.path, ...(row.thumbPath ? [row.thumbPath] : [])];
		return { kind: 'photo.delete', payload: { photoId, photoKind: row.kind } };
	});
	for (const f of files) await rm(absolute(f), { force: true }).catch(() => {});
}

/** Bytes and content type of a photo for a member of the build's workspace (404 otherwise). */
export async function readPhoto(
	db: Db,
	buildId: string,
	userId: string,
	photoId: string,
	thumb: boolean
): Promise<{ bytes: Uint8Array; type: ImageType }> {
	if (!buildAccess(db, buildId, userId)) throw new ApiError(404, 'Not found');
	const row = db
		.select()
		.from(buildPhotos)
		.where(and(eq(buildPhotos.buildId, buildId), eq(buildPhotos.id, photoId)))
		.get();
	if (!row) throw new ApiError(404, 'Not found');
	const rel = thumb && row.thumbPath ? row.thumbPath : row.path;
	try {
		const bytes = new Uint8Array(await readFile(absolute(rel)));
		return { bytes, type: sniffImage(bytes) ?? 'image/webp' };
	} catch {
		throw new ApiError(404, 'Not found');
	}
}

/** Remove every photo file of a build (after the build row is deleted). */
export async function removeBuildPhotoFiles(buildId: string): Promise<void> {
	await rm(join(uploadsDir(), 'photos', buildId), { recursive: true, force: true }).catch(() => {});
}
