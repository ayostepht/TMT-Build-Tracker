import { ApiError } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { loadBuildView } from '#lib/server/builds/view.ts';
import { addPhoto, MAX_PHOTO_BYTES, MAX_THUMB_BYTES } from '#lib/server/builds/photos.ts';
import { requireUserId, respond } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** The build's photos (members). */
export const GET: RequestHandler = (event) =>
	respond(() => {
		const view = loadBuildView(getDb(), event.params.id, requireUserId(event));
		if (!view) throw new ApiError(404, 'Not found');
		return { photos: view.photos };
	});

/**
 * Multipart upload (editor or owner): `file` (image, up to 8 MB, JPEG/PNG/WebP), optional `thumb`
 * (up to 1 MB), `kind` (progress | finished | handoff), `caption`, `width`, `height`. Metadata is stripped.
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const userId = requireUserId(event);
		const declared = Number(event.request.headers.get('content-length') ?? '');
		if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES + MAX_THUMB_BYTES + 65536)
			throw new ApiError(413, 'The photo is larger than 8 MB');
		let form: FormData;
		try {
			form = await event.request.formData();
		} catch {
			throw new ApiError(400, 'Send the photo as multipart form data');
		}
		const file = form.get('file');
		const thumb = form.get('thumb');
		if (!(file instanceof File)) throw new ApiError(400, 'Missing the photo file');
		const id = await addPhoto(getDb(), event.params.id, userId, {
			kind: form.get('kind'),
			caption: form.get('caption') ?? '',
			width: form.get('width'),
			height: form.get('height'),
			file: new Uint8Array(await file.arrayBuffer()),
			thumb: thumb instanceof File ? new Uint8Array(await thumb.arrayBuffer()) : null
		});
		return { id };
	});
