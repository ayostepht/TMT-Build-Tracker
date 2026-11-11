/**
 * Per-user write rate limit for the app API: a token bucket in memory, keyed by user id.
 *
 * - Applies to every non-GET/HEAD/OPTIONS request of a signed-in user, whatever the path (API
 *   routes and page form actions), except `/api/auth/*` (Better Auth rate-limits those itself). Site admins are exempt (looked up only when a request is refused).
 * - Public mode: `WRITE_RATE_PER_MIN` (default 120) refill, `WRITE_RATE_BURST` (default 60) bucket.
 *   Self-hosted: off unless `WRITE_RATE_PER_MIN` is set. `off` (or 0) disables it.
 * - Refusal: 429 with `Retry-After` (seconds). `/api/` or JSON callers get `{ error, code: 'rate' }`;
 *   a `use:enhance` form action (header `x-sveltekit-action`) gets a SvelteKit action failure
 *   (`form.error` / `form.code`, the same shape as `fail(409, { error })`); a plain form post gets
 *   a small HTML page with the message and a back link.
 * - State is per process; a restart resets it, which is fine for a burst limiter.
 */
import { isSiteAdmin } from './access';
import { isPublicMode } from './config';
import { getDb } from './db/index';

export interface WriteRateConfig {
	perMin: number;
	burst: number;
}

function num(name: string): number | null | undefined {
	const raw = (process.env[name] ?? '').trim().toLowerCase();
	if (!raw) return undefined;
	if (raw === 'off' || raw === 'unlimited' || raw === 'none') return null;
	return /^\d+$/.test(raw) ? Number(raw) : undefined;
}

/** The active limit, or null when off. Read per call so the environment is honoured. */
export function writeRateConfig(): WriteRateConfig | null {
	const perMin = num('WRITE_RATE_PER_MIN');
	const pub = isPublicMode();
	const rate = perMin === undefined ? (pub ? 120 : null) : perMin;
	if (rate === null || rate === 0) return null;
	const burst = num('WRITE_RATE_BURST');
	return { perMin: rate, burst: burst ? burst : pub ? 60 : Math.max(1, Math.ceil(rate / 2)) };
}

interface Bucket {
	tokens: number;
	at: number;
}
const buckets = new Map<string, Bucket>();
const IDLE_MS = 10 * 60_000;

/** Take one token for `userId`. Returns 0 when allowed, else the seconds to wait. */
export function takeWriteToken(userId: string, cfg: WriteRateConfig, now = Date.now()): number {
	if (buckets.size > 5000) {
		for (const [k, b] of buckets) if (now - b.at > IDLE_MS) buckets.delete(k);
	}
	const b = buckets.get(userId) ?? { tokens: cfg.burst, at: now };
	const perMs = cfg.perMin / 60_000;
	b.tokens = Math.min(cfg.burst, b.tokens + (now - b.at) * perMs);
	b.at = now;
	buckets.set(userId, b);
	if (b.tokens >= 1) {
		b.tokens -= 1;
		return 0;
	}
	return Math.max(1, Math.ceil((1 - b.tokens) / perMs / 1000));
}

/** Forget all buckets (tests). */
export function resetWriteRate(): void {
	buckets.clear();
}

const READ = new Set(['GET', 'HEAD', 'OPTIONS']);

const esc = (v: string) =>
	v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Where "Go back" points on the plain-form refusal page: the Referer's path when it is on this
 * same host and a plain relative path, else the home page. A real link, not `javascript:`
 * (the page CSP blocks that and it needs no inline script).
 */
export function backPath(headers?: Headers): string {
	const ref = headers?.get('referer');
	const host = headers?.get('x-forwarded-host') ?? headers?.get('host');
	if (!ref || !host) return '/';
	try {
		const u = new URL(ref);
		const path = u.pathname + u.search;
		if (u.host !== host || !path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
			return '/';
		return path;
	} catch {
		return '/';
	}
}

/**
 * The 429 response when this request must be refused, else null. Call once the user is known.
 * `isAdmin` defaults to the database lookup; tests pass their own.
 */
export function writeRateResponse(
	user: { id: string; email?: string | null; emailVerified?: boolean | null } | null,
	method: string,
	pathname: string,
	isAdmin: (u: NonNullable<typeof user>) => boolean = (u) => isSiteAdmin(getDb(), u),
	now = Date.now(),
	headers?: Headers
): Response | null {
	if (!user || READ.has(method.toUpperCase())) return null;
	if (pathname.startsWith('/api/auth/')) return null;
	const cfg = writeRateConfig();
	if (!cfg) return null;
	const wait = takeWriteToken(user.id, cfg, now);
	if (wait === 0 || isAdmin(user)) return null;
	const error = 'Too many changes too quickly. Wait a moment and try again.';
	const retry = String(wait);
	if (headers?.get('x-sveltekit-action') === 'true') {
		// SvelteKit's `deserialize` expects `{ type, status, data }` with `data` devalue-encoded.
		return new Response(
			JSON.stringify({
				type: 'failure',
				status: 429,
				data: JSON.stringify([{ error: 1, code: 2 }, error, 'rate'])
			}),
			{ status: 200, headers: { 'content-type': 'application/json', 'retry-after': retry } }
		);
	}
	const wantsJson =
		pathname.startsWith('/api/') || !(headers?.get('accept') ?? '').includes('text/html');
	if (wantsJson)
		return new Response(JSON.stringify({ error, code: 'rate' }), {
			status: 429,
			headers: { 'content-type': 'application/json', 'retry-after': retry }
		});
	return new Response(
		`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Too many changes</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>Too many changes</h1><p>${error}</p><p><a href="${esc(backPath(headers))}">Go back</a></p></body>`,
		{ status: 429, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': retry } }
	);
}
