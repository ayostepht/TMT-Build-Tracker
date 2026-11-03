import { readFile } from 'node:fs/promises';
import { json } from '@sveltejs/kit';
import { ApiError } from './access';

/** Serve a PNG from disk with the app's JSON error shape. */
export async function pngResponse(path: string | null): Promise<Response> {
	if (!path) return json({ error: 'No thumbnail' }, { status: 404 });
	try {
		const bytes = await readFile(path);
		return new Response(new Uint8Array(bytes), {
			headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' }
		});
	} catch {
		return json({ error: 'No thumbnail' }, { status: 404 });
	}
}

export function apiErrorResponse(e: unknown): Response | null {
	return e instanceof ApiError ? json({ error: e.message }, { status: e.status }) : null;
}
