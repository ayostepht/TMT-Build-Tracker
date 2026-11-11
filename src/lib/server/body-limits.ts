/**
 * Request body caps, enforced in `hooks.server.ts` before any handler runs.
 *
 * adapter-node's `BODY_SIZE_LIMIT` is one global number (1100M in the image) because the 3MF and
 * STEP uploads need it, which also let a JSON route buffer 1 GB. Here every route gets its own cap
 * (a small default plus a table for the ones that take files) and it is enforced twice: a declared
 * `Content-Length` over the cap is refused up front, and the body stream is wrapped so a chunked or
 * lying client errors with 413 the moment it passes the cap. A handler that calls `request.json()`
 * or `formData()` therefore never buffers more than its cap.
 */
import { ApiError } from './access';
import { maxThreeMfBytes } from './config';
import { MAX_PHOTO_BYTES, MAX_THUMB_BYTES } from './builds/photos';
import { MAX_GUIDE_PAGE_BYTES } from './guide';
import { MAX_SNAPSHOT_BYTES } from './designs/files';

const KB = 1024;
const MB = 1024 * KB;

/** JSON APIs and form posts. The largest real JSON body is far smaller. */
export const DEFAULT_BODY_CAP = 1 * MB;
/** Better Auth requests: e-mail, password, name, a token. */
export const AUTH_BODY_CAP = 64 * KB;
/** STEP zips, independent of `MAX_3MF_MB` (the route enforces the same number). */
export const STEP_ZIP_BYTES = 200 * MB;
/** Multipart framing and form fields around a raw file. */
const FRAMING = 1 * MB;

export interface BodyCapRule {
	/** Matches the pathname. */
	pattern: RegExp;
	/** Methods the rule applies to; empty means all. */
	methods: string[];
	/** Bytes; a function so `MAX_3MF_MB` is read when the request arrives. */
	cap: () => number;
	/** What the route takes, for the docs table and the error message. */
	what: string;
}

/** First match wins. Keep in step with the table in `docs/architecture.md` ("Release and deployment"). */
export const BODY_CAP_RULES: BodyCapRule[] = [
	{
		pattern: /^\/api\/builds\/[^/]+\/plates\/upload$/,
		methods: ['POST'],
		cap: () => maxThreeMfBytes() + FRAMING,
		what: 'slicer 3MF (MAX_3MF_MB)'
	},
	{
		pattern: /^\/api\/templates\/[^/]+\/print-geometry$/,
		methods: ['POST'],
		cap: () => maxThreeMfBytes() + FRAMING,
		what: 'print-geometry 3MF (MAX_3MF_MB)'
	},
	{
		pattern: /^\/api\/templates\/[^/]+\/model$/,
		methods: ['POST'],
		cap: () => STEP_ZIP_BYTES + FRAMING,
		what: 'STEP zip'
	},
	{
		pattern: /^\/api\/builds\/[^/]+\/photos$/,
		methods: ['POST'],
		cap: () => MAX_PHOTO_BYTES + MAX_THUMB_BYTES + 64 * KB,
		what: 'photo and thumbnail'
	},
	{
		pattern: /^\/api\/templates\/[^/]+\/guide\/pages\/[^/]+$/,
		methods: ['POST'],
		cap: () => MAX_GUIDE_PAGE_BYTES,
		what: 'guide page image'
	},
	{
		pattern: /^\/api\/designs\/[^/]+\/snapshot$/,
		methods: ['PUT'],
		cap: () => MAX_SNAPSHOT_BYTES,
		what: 'design snapshot PNG'
	},
	{
		pattern: /^\/api\/auth\//,
		methods: [],
		cap: () => AUTH_BODY_CAP,
		what: 'sign-in request'
	}
];

export function bodyCapFor(method: string, pathname: string): { cap: number; what: string } {
	const m = method.toUpperCase();
	for (const rule of BODY_CAP_RULES) {
		if (rule.methods.length && !rule.methods.includes(m)) continue;
		if (rule.pattern.test(pathname)) return { cap: rule.cap(), what: rule.what };
	}
	return { cap: DEFAULT_BODY_CAP, what: 'request' };
}

/** Thrown into a body stream that passed its cap. An `ApiError`, so `respond()` answers 413. */
export class BodyTooLargeError extends ApiError {
	constructor(public cap: number) {
		super(413, `The request is larger than ${formatBytes(cap)}`);
	}
}

export function formatBytes(n: number): string {
	if (n >= MB) return `${Math.round((n / MB) * 10) / 10} MB`.replace('.0 MB', ' MB');
	return `${Math.max(1, Math.round(n / KB))} kB`;
}

/** The size a `Content-Length` header declares, or null when absent or not a plain number. */
export function declaredLength(headers: Headers): number | null {
	const raw = headers.get('content-length');
	if (raw === null || !/^\d+$/.test(raw.trim())) return null;
	const n = Number(raw);
	return Number.isSafeInteger(n) ? n : null;
}

/** Whether a declared length is already over the cap (refuse before reading anything). */
export function declaredTooLarge(headers: Headers, cap: number): boolean {
	const n = declaredLength(headers);
	return n !== null && n > cap;
}

export interface LimitedBody {
	/** The stream to hand to the handler: errors with `BodyTooLargeError` past the cap. */
	stream: ReadableStream<Uint8Array>;
	/** True once the cap was passed. */
	exceeded: () => boolean;
}

/**
 * Passes `source` through and errors the result with `BodyTooLargeError` once more than `cap` bytes
 * went by. It does not cancel the source at that point: cancelling destroys the socket and the
 * client would never see the 413. The remainder is read and discarded instead (never held), up to
 * `cap` + `drainExtra` more bytes; past that the source is cancelled and the connection dropped.
 */
export function limitStream(
	source: ReadableStream<Uint8Array>,
	cap: number,
	drainExtra = 8 * MB
): LimitedBody {
	const reader = source.getReader();
	let seen = 0;
	let tripped = false;
	const drain = async () => {
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) return;
				seen += value.byteLength;
				if (seen > cap + drainExtra) {
					await reader.cancel();
					return;
				}
			}
		} catch {
			// the source failed (client gone, adapter limit): nothing left to drain
		}
	};
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) {
				controller.close();
				return;
			}
			seen += value.byteLength;
			if (seen > cap) {
				tripped = true;
				controller.error(new BodyTooLargeError(cap));
				void drain();
				return;
			}
			controller.enqueue(value);
		},
		cancel(reason) {
			return reader.cancel(reason);
		}
	});
	return { stream, exceeded: () => tripped };
}

/**
 * A copy of `request` whose body cannot exceed `cap`. Requests without a body come back as they
 * are. The copy keeps method, headers, signal and `Content-Length`; handlers that stream
 * `request.body` (the uploads) read the counted stream, the others call `json()`/`formData()` on it.
 */
export function limitRequest(
	request: Request,
	cap: number
): { request: Request; exceeded: () => boolean } {
	if (!request.body) return { request, exceeded: () => false };
	const limited = limitStream(request.body, cap);
	const copy = new Request(request, { body: limited.stream, duplex: 'half' } as RequestInit);
	return { request: copy, exceeded: limited.exceeded };
}

/** The response for a refused body. */
export function tooLargeResponse(cap: number, asJson: boolean, early: boolean): Response {
	const message = `The request is larger than ${formatBytes(cap)}`;
	const headers: Record<string, string> = early ? { connection: 'close' } : {};
	return asJson
		? Response.json({ error: message }, { status: 413, headers })
		: new Response(message, {
				status: 413,
				headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' }
			});
}
