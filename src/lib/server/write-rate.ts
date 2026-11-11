/**
 * Per-user write rate limit for the app API: a token bucket in memory, keyed by user id.
 *
 * - Applies to non-GET/HEAD/OPTIONS requests under `/api/`, except `/api/auth/*` (Better Auth
 *   rate-limits those itself). Site admins are exempt (looked up only when a request is refused).
 * - Public mode: `WRITE_RATE_PER_MIN` (default 120) refill, `WRITE_RATE_BURST` (default 60) bucket.
 *   Self-hosted: off unless `WRITE_RATE_PER_MIN` is set. `off` (or 0) disables it.
 * - Refusal: 429 `{ error, code: 'rate' }` with `Retry-After` (seconds).
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

/**
 * The 429 response when this request must be refused, else null. Call once the user is known.
 * `isAdmin` defaults to the database lookup; tests pass their own.
 */
export function writeRateResponse(
	user: { id: string; email?: string | null; emailVerified?: boolean | null } | null,
	method: string,
	pathname: string,
	isAdmin: (u: NonNullable<typeof user>) => boolean = (u) => isSiteAdmin(getDb(), u),
	now = Date.now()
): Response | null {
	if (!user || READ.has(method.toUpperCase())) return null;
	if (!pathname.startsWith('/api/') || pathname.startsWith('/api/auth/')) return null;
	const cfg = writeRateConfig();
	if (!cfg) return null;
	const wait = takeWriteToken(user.id, cfg, now);
	if (wait === 0 || isAdmin(user)) return null;
	return new Response(
		JSON.stringify({
			error: 'Too many changes too quickly. Wait a moment and try again.',
			code: 'rate'
		}),
		{
			status: 429,
			headers: { 'content-type': 'application/json', 'retry-after': String(wait) }
		}
	);
}
