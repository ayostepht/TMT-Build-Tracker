import { json, type RequestEvent } from '@sveltejs/kit';
import { ApiError } from './access';

export function requireUserId(event: RequestEvent): string {
	if (!event.locals.user) throw new ApiError(401, 'Sign in required');
	return event.locals.user.id;
}

/** Default cap for a JSON body (the hook enforces the same per route; this is the second line of defence). */
export const JSON_BODY_BYTES = 1024 * 1024;

/**
 * The request body as JSON. Reads at most `maxBytes` (default 1 MB) and answers 413 beyond it,
 * whatever the headers claim, so a handler can never buffer a huge body.
 */
export async function readJson(event: RequestEvent, maxBytes = JSON_BODY_BYTES): Promise<unknown> {
	const text = await readTextCapped(event.request, maxBytes);
	try {
		return JSON.parse(text);
	} catch {
		throw new ApiError(400, 'Invalid JSON');
	}
}

/** The body as text, 413 once it passes `maxBytes` (counted as it streams in, not from a header). */
export async function readTextCapped(request: Request, maxBytes: number): Promise<string> {
	const tooBig = () =>
		new ApiError(413, `The request is larger than ${Math.max(1, Math.round(maxBytes / 1024))} kB`);
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBytes) throw tooBig();
	if (!request.body) return '';
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) throw tooBig();
			chunks.push(value);
		}
	} catch (e) {
		if (e instanceof ApiError) throw e;
		throw new ApiError(400, 'The request body could not be read');
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Text to log for an unexpected error: name, message and stack only. Database errors carry the
 * bound query parameters (and a `cause`); those are never logged, and the message of a Drizzle
 * query error (which embeds them after `params:`) is cut before them.
 */
export function safeErrorText(e: unknown): string {
	if (!(e instanceof Error)) return 'non-error thrown';
	const strip = (t: string) => t.replace(/\n?params:[\s\S]*$/, '').trimEnd();
	const stack = (e.stack ?? '')
		.split('\n')
		.filter((l) => /^\s+at /.test(l))
		.join('\n');
	return `${e.name}: ${strip(e.message)}${stack ? `\n${stack}` : ''}`;
}

/** Run a handler body, mapping ApiError to `{ error }` JSON with its status. */
export async function respond(fn: () => unknown | Promise<unknown>): Promise<Response> {
	try {
		const out = await fn();
		return json({ ok: true, ...(out && typeof out === 'object' ? out : {}) });
	} catch (e) {
		if (e instanceof ApiError) {
			// An error may carry a machine-readable `code` (quota refusals send 'quota').
			const code = (e as { code?: unknown }).code;
			// ...and extra JSON fields (`BuildStartedError` sends `started` and `summary`).
			const extra = (e as { extra?: unknown }).extra;
			return json(
				{
					...(extra && typeof extra === 'object' ? extra : {}),
					error: e.message,
					...(typeof code === 'string' ? { code } : {})
				},
				{ status: e.status }
			);
		}
		console.error('[tmt] api error', safeErrorText(e));
		return json({ error: 'Internal error' }, { status: 500 });
	}
}
