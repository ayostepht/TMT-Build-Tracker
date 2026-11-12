import { statfsSync } from 'node:fs';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
// Runtime configuration read from environment variables. Kept free of SvelteKit
// imports so it can be used from tests and tooling.
const env = process.env;
const isProd = env.NODE_ENV === 'production';

export function databaseUrl(): string {
	return env.DATABASE_URL || (isProd ? '/data/tmt.db' : './data/tmt.db');
}

const PUBLIC_URL_VARS = ['PUBLIC_URL', 'BETTER_AUTH_URL', 'ORIGIN'] as const;

/** The first of `PUBLIC_URL`, `BETTER_AUTH_URL`, `ORIGIN` that is set, with its raw value. */
function rawPublicUrl(): { name: string; value: string } | null {
	for (const name of PUBLIC_URL_VARS) {
		const value = (env[name] ?? '').trim();
		if (value) return { name, value };
	}
	return null;
}

/**
 * Public URL of the app (`PUBLIC_URL`, or the older `BETTER_AUTH_URL` / `ORIGIN`),
 * normalised to an origin with no trailing slash. Returns null when unset, in
 * which case the origin is taken from each request (see scripts/proxy-origin.mjs).
 * Errors name the variable but never echo its value (it may carry credentials).
 */
export function publicUrl(): string | null {
	const raw = rawPublicUrl();
	if (!raw) return null;
	let url: URL;
	try {
		url = new URL(raw.value);
	} catch {
		throw new Error(`${raw.name} is not a valid URL.`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`${raw.name} must start with http:// or https://.`);
	}
	return url.origin;
}

const DEV_SECRET = 'dev-only-insecure-secret-change-me-0123456789';
const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARS = 10;
// Whole value (or the same word repeated) after dropping separators.
const WEAK_WORD = /^(change ?me|secret|password|passw0rd|letmein|default|test|admin|example)+$/;
// Obvious placeholder phrases anywhere in the value. Not a complete list.
const WEAK_PHRASE = /change|your[-_ ]?secret|example|placeholder|replace[-_ ]?me|insecure|dev-only/;

/**
 * Problems with a secret value; empty when it is acceptable. Messages never contain the
 * value. Obvious placeholders only: this is a guard against copy-paste mistakes, not a
 * strength meter.
 */
export function secretProblems(secret: string | undefined): string[] {
	const value = (secret ?? '').trim();
	if (!value) {
		return ['BETTER_AUTH_SECRET must be set (generate one with `openssl rand -hex 32`).'];
	}
	const problems: string[] = [];
	if (value.length < MIN_SECRET_LENGTH) {
		problems.push(
			`BETTER_AUTH_SECRET is too short (${value.length} characters, need at least ${MIN_SECRET_LENGTH}). Generate one with \`openssl rand -hex 32\`.`
		);
	}
	if (new Set(value).size < MIN_DISTINCT_CHARS) {
		problems.push(
			`BETTER_AUTH_SECRET has too few distinct characters (need at least ${MIN_DISTINCT_CHARS}). Generate one with \`openssl rand -hex 32\`.`
		);
	}
	const lower = value.toLowerCase();
	if (WEAK_WORD.test(lower.replace(/[-_\s]/g, '')) || WEAK_PHRASE.test(lower)) {
		problems.push(
			'BETTER_AUTH_SECRET looks like a placeholder. Generate a real one with `openssl rand -hex 32`.'
		);
	}
	return problems;
}

/** Only `NODE_ENV=development` (vite dev) and `NODE_ENV=test` (vitest) may run without a real secret. */
function secretRelaxed(): boolean {
	const nodeEnv = env.NODE_ENV;
	return (nodeEnv === 'development' || nodeEnv === 'test') && !isPublicMode();
}

/**
 * Signing/encryption secret (`BETTER_AUTH_SECRET`). Enforced (set, 32+ characters, not an
 * obvious placeholder) unless `NODE_ENV` is exactly `development` or `test`, and always in
 * public mode; an unset `NODE_ENV` is treated as production. Relaxed runs fall back to a
 * fixed dev secret. There is no build-time exemption: the secret is only read at runtime
 * (`hooks.server.ts` init, behind the `building` guard). Errors never include the secret.
 */
export function authSecret(): string {
	const secret = env.BETTER_AUTH_SECRET;
	if (secretRelaxed()) return secret || DEV_SECRET;
	const problems = secretProblems(secret);
	if (problems.length) throw new Error(problems.join(' '));
	return secret as string;
}

export type AppMode = 'selfhost' | 'public';

/** `TMT_MODE`: `selfhost` (default) or `public` (SSO-only hosted instance). Anything else throws. */
export function appMode(): AppMode {
	const raw = (env.TMT_MODE ?? '').trim().toLowerCase();
	if (!raw) return 'selfhost';
	if (raw === 'selfhost' || raw === 'public') return raw;
	throw new Error(`TMT_MODE must be "selfhost" or "public", got "${env.TMT_MODE}".`);
}

export function isPublicMode(): boolean {
	return appMode() === 'public';
}

export type SignupMode = 'open' | 'invite' | 'closed';

/**
 * `SIGNUP`: `open` (default), `invite` or `closed`. Applies to self-hosted email/password
 * sign-up; in `public` mode password sign-up does not exist at all.
 */
export function signupMode(): SignupMode {
	const raw = (env.SIGNUP ?? '').trim().toLowerCase();
	if (!raw) return 'open';
	if (raw === 'open' || raw === 'invite' || raw === 'closed') return raw;
	throw new Error(`SIGNUP must be "open", "invite" or "closed", got "${env.SIGNUP}".`);
}

export interface SocialProviderConfig {
	clientId: string;
	clientSecret: string;
}

export interface SocialProviders {
	google?: SocialProviderConfig;
	github?: SocialProviderConfig;
}

function socialPair(name: string, idVar: string, secretVar: string): SocialProviderConfig | null {
	const clientId = (env[idVar] ?? '').trim();
	const clientSecret = (env[secretVar] ?? '').trim();
	if (!clientId && !clientSecret) return null;
	if (!clientId || !clientSecret) {
		throw new Error(
			`${name} sign-in is half configured: set both ${idVar} and ${secretVar}, or neither.`
		);
	}
	return { clientId, clientSecret };
}

/** Google / GitHub OAuth apps, each configured only when both of its variables are set. */
export function socialProviders(): SocialProviders {
	const out: SocialProviders = {};
	const google = socialPair('Google', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
	if (google) out.google = google;
	const github = socialPair('GitHub', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET');
	if (github) out.github = github;
	return out;
}

export interface TrustedProxy {
	/** Lower-cased header carrying the client address (adapter-node `ADDRESS_HEADER`). */
	header: string;
	/** Proxies to skip from the right of `X-Forwarded-For` (adapter-node `XFF_DEPTH`, default 1). */
	xffDepth: number;
}

/**
 * Whether the server sits behind a reverse proxy whose address header can be trusted. This is
 * adapter-node's own `ADDRESS_HEADER` (typically `X-Forwarded-For`) plus `XFF_DEPTH`; no
 * separate variable. Null means no trusted header: `getClientAddress()` is the socket address.
 * `getClientAddress()` also feeds the sign-in rate limits (see `client-ip.ts`).
 *
 * Only set `ADDRESS_HEADER` when ALL traffic reaches the app through the proxy: for any
 * header other than `x-forwarded-for`, adapter-node uses the value verbatim, so a client
 * that can reach the port directly can send whatever address it likes. `XFF_DEPTH` only
 * applies to `x-forwarded-for` (adapter-node counts from the right of the chain).
 */
export function trustedProxy(): TrustedProxy | null {
	const header = (env.ADDRESS_HEADER ?? '').trim().toLowerCase();
	if (!header) return null;
	const raw = (env.XFF_DEPTH ?? '').trim();
	// Strict digits: adapter-node uses parseInt, which would accept "2abc" as 2.
	if (raw && !/^\d+$/.test(raw)) {
		throw new Error('XFF_DEPTH must be a positive whole number (digits only).');
	}
	const xffDepth = raw ? Number(raw) : 1;
	if (!Number.isSafeInteger(xffDepth) || xffDepth < 1) {
		throw new Error('XFF_DEPTH must be a positive whole number (digits only).');
	}
	return { header, xffDepth };
}

function publicUrlProblems(): string[] {
	const raw = rawPublicUrl();
	if (!raw) return ['PUBLIC_URL must be set in public mode.'];
	const name = raw.name;
	let url: URL;
	try {
		url = new URL(raw.value);
	} catch {
		return [`${name} is not a valid URL.`];
	}
	const problems: string[] = [];
	if (url.protocol !== 'https:')
		problems.push(`${name} must be an https:// address in public mode.`);
	if (url.username || url.password)
		problems.push(`${name} must not contain a user name or password.`);
	if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
		problems.push(`${name} must be just the origin (https://host), without a path or query.`);
	}
	// A trailing dot (`localhost.`) is the same host.
	const host = url.hostname.toLowerCase().replace(/\.+$/, '');
	if (host === 'localhost' || host.endsWith('.localhost')) {
		problems.push(`${name} must be a public host name, not localhost.`);
	} else if (isIP(host) || host.startsWith('[')) {
		problems.push(`${name} must be a host name, not an IP address.`);
	}
	return problems;
}

/** Problems that make `TMT_MODE=public` unsafe to start; empty when fine or not in public mode. */
export function validatePublicMode(): string[] {
	if (!isPublicMode()) return [];
	const problems = publicUrlProblems();
	try {
		if (Object.keys(socialProviders()).length === 0) {
			problems.push(
				'Public mode needs at least one sign-in provider: set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET or GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET.'
			);
		}
	} catch (e) {
		problems.push((e as Error).message);
	}
	if (['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'].some((k) => (env[k] ?? '').trim())) {
		problems.push(
			'Public mode supports only Google and GitHub sign-in: unset the OIDC_* variables.'
		);
	}
	try {
		if (!trustedProxy()) {
			problems.push(
				'Public mode needs a trusted reverse proxy: set ADDRESS_HEADER (for example X-Forwarded-For) and, if more than one proxy is in front, XFF_DEPTH.'
			);
		}
	} catch (e) {
		problems.push((e as Error).message);
	}
	if (adminEmails().length === 0) {
		problems.push('ADMIN_EMAILS must list at least one site admin in public mode.');
	}
	return problems;
}

/**
 * Everything wrong with the configuration at boot, one message per problem, never containing
 * a secret. Empty when the server may start. Called from `hooks.server.ts` init.
 */
export function bootProblems(): string[] {
	const problems: string[] = [];
	const guard = (fn: () => unknown) => {
		try {
			fn();
		} catch (e) {
			problems.push((e as Error).message);
		}
	};
	let mode: AppMode;
	try {
		mode = appMode();
	} catch (e) {
		problems.push((e as Error).message);
		return problems;
	}
	if (!secretRelaxed()) problems.push(...secretProblems(env.BETTER_AUTH_SECRET));
	guard(() => signupMode());
	guard(() => trustedProxy());
	guard(() => publicUrl());
	guard(() => quotas());
	guard(() => linkPrintersPerWorkspace());
	guard(() => linkPrintersTotal());
	guard(() => manualPrintersPerWorkspace());
	guard(() => minFreeDiskBytes());
	guard(() => writeRateVars());
	if (mode === 'public') problems.push(...validatePublicMode());
	return [...new Set(problems)];
}

export interface OidcConfig {
	issuer: string;
	clientId: string;
	clientSecret: string;
	providerName: string;
}

export function oidcConfig(): OidcConfig | null {
	const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_PROVIDER_NAME } = env;
	if (!OIDC_ISSUER || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) return null;
	return {
		issuer: OIDC_ISSUER.replace(/\/+$/, ''),
		clientId: OIDC_CLIENT_ID,
		clientSecret: OIDC_CLIENT_SECRET,
		providerName: OIDC_PROVIDER_NAME || 'SSO'
	};
}

/** Directory holding the database file (the `/data` volume in Docker). `:memory:` databases use the OS temp dir. */
export function dataDir(): string {
	const url = databaseUrl();
	return url === ':memory:' ? tmpdir() : dirname(resolve(url));
}

/** Where user-imported files live (never in git): `<dataDir>/uploads`. */
export function uploadsDir(): string {
	return join(dataDir(), 'uploads');
}

/** Absolute path of the assembled model GLB for a template: `<uploadsDir>/models/<templateId>.glb`. */
export function templateModelPath(templateId: string): string {
	return join(uploadsDir(), 'models', `${templateId}.glb`);
}

/** Absolute path of the optional neutral hardware GLB: `<uploadsDir>/models/<templateId>-hardware.glb`. */
export function templateHardwarePath(templateId: string): string {
	return join(uploadsDir(), 'models', `${templateId}-hardware.glb`);
}

/** Where uploaded STEP zips wait for their conversion job: `<uploadsDir>/imports`. */
export function importsDir(): string {
	return join(uploadsDir(), 'imports');
}

/** Lower-cased emails in `ADMIN_EMAILS` (comma-separated) that count as site admins. */
export function adminEmails(): string[] {
	return (env.ADMIN_EMAILS ?? '')
		.split(',')
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
}

/** Where baked-in kit packs live (`index.json` plus `*.kitpack`): `/app/kitpacks` in the image, `./kitpacks` in dev. */
export function kitpackDir(): string {
	return env.KITPACK_DIR || (isProd ? '/app/kitpacks' : './kitpacks');
}

/**
 * Download location for a pack that is not in `kitpackDir()`. May contain `{slug}`, `{version}`
 * and `{file}`; without placeholders it is a base URL and `/<file>` is appended. `file://` works.
 */
export function kitpackUrl(): string {
	return (
		env.KITPACK_URL ||
		'https://github.com/ayostepht/TMT-Build-Tracker/releases/download/kitpack-{slug}-{version}/{file}'
	);
}

/** `KITPACK_DOWNLOAD=off` turns the download fallback off (tests, offline installs). */
export function kitpackDownloadEnabled(): boolean {
	return !/^(off|0|false|no)$/i.test((env.KITPACK_DOWNLOAD ?? '').trim());
}

/**
 * Largest 3MF upload in bytes: `MAX_3MF_MB` when set, otherwise 1024 (selfhost) or 256 (public mode,
 * where strangers upload). Sliced projects with G-code for every plate reach several hundred MB.
 */
export function maxThreeMfBytes(): number {
	const mb = Number(process.env.MAX_3MF_MB);
	const fallback = isPublicMode() ? 256 : 1024;
	return (Number.isFinite(mb) && mb > 0 ? mb : fallback) * 1024 * 1024;
}

/** Largest request body adapter-node's `BODY_SIZE_LIMIT` allows, in bytes; `Infinity` when set to it, null when unset or unparsable. */
export function bodySizeLimitBytes(): number | null {
	const raw = (env.BODY_SIZE_LIMIT ?? '').trim();
	if (!raw) return null;
	if (raw === 'Infinity') return Infinity;
	// Same grammar as adapter-node: a number with an optional K, M or G suffix.
	const m = /^(\d+)([KMG]?)$/.exec(raw);
	if (!m) return null;
	const unit = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2] as '' | 'K' | 'M' | 'G'];
	return Number(m[1]) * unit;
}

/**
 * A warning (not a boot problem: the server still runs) when `BODY_SIZE_LIMIT`, the outer bound on
 * every request body, is below what `MAX_3MF_MB` allows: 3MF uploads would fail with 413 from
 * adapter-node before the app's own per-route cap (`body-limits.ts`) is reached. Null when fine.
 */
export function bodyLimitWarning(): string | null {
	if (!isProd) return null;
	const need = maxThreeMfBytes() + 1024 * 1024;
	const have = bodySizeLimitBytes();
	if (have === Infinity) return null;
	const needMb = Math.ceil(need / 1048576);
	if (have === null) {
		return `BODY_SIZE_LIMIT is not set (adapter-node then refuses bodies over 512 kB): set it to at least ${needMb}M so 3MF uploads work.`;
	}
	if (have < need) {
		return `BODY_SIZE_LIMIT is smaller than MAX_3MF_MB allows: 3MF uploads over ${Math.floor(have / 1048576)} MB fail with 413. Set BODY_SIZE_LIMIT to at least ${needMb}M.`;
	}
	return null;
}

/**
 * Limits per workspace, user, chapter or build. A field is a count (or bytes), or `null` for no limit.
 * Defaults depend on `TMT_MODE`: `selfhost` has no limits, `public` has finite ones sized for volunteer
 * makers who each build one or two chairs. Every field has a `QUOTA_*` variable (digits, or `off`).
 * This is only the configuration contract: whichever feature creates the thing reads its field here
 * and refuses with a clear message; a field nothing reads yet limits nothing.
 */
export interface Quotas {
	/** Builds (all statuses, drafts excluded) in one workspace (chapter or personal). `QUOTA_BUILDS_PER_WORKSPACE` */
	buildsPerWorkspace: number | null;
	/** Draft builds (the Studio and unfinished wizards) one user owns. `QUOTA_DRAFTS_PER_USER` */
	draftsPerUser: number | null;
	/** Chapters (teams) one user may create. `QUOTA_CHAPTERS_PER_USER` */
	chaptersPerUser: number | null;
	/** Members in one chapter. `QUOTA_MEMBERS_PER_CHAPTER` */
	membersPerChapter: number | null;
	/** Open (pending) invitations in one chapter. `QUOTA_PENDING_INVITES_PER_CHAPTER` */
	pendingInvitesPerChapter: number | null;
	/** Photos on one build. `QUOTA_PHOTOS_PER_BUILD` */
	photosPerBuild: number | null;
	/** Kit copies (forks of a template) in one workspace. `QUOTA_KIT_COPIES_PER_WORKSPACE` */
	kitCopiesPerWorkspace: number | null;
	/** Custom filaments in one workspace. `QUOTA_CUSTOM_FILAMENTS_PER_WORKSPACE` */
	customFilamentsPerWorkspace: number | null;
	/** Saved color designs one user owns. `QUOTA_SAVED_DESIGNS_PER_USER` */
	savedDesignsPerUser: number | null;
	/** Bytes of uploaded files (photos, kept 3MFs, snapshots, guide images) in one workspace; the variable is in MB. `QUOTA_UPLOAD_MB_PER_WORKSPACE` */
	uploadBytesPerWorkspace: number | null;
	/** Bytes of uploaded files across every workspace one user owns (their personal one and their chapters); the variable is in MB. `QUOTA_UPLOAD_MB_PER_USER` */
	uploadBytesPerUser: number | null;
	/** STEP to GLB conversions one user may have queued or running. `QUOTA_STEP_CONVERSIONS_PER_USER` */
	stepConversionsPerUser: number | null;
	/** Open live-update (SSE) connections one user may hold. `QUOTA_SSE_CONNECTIONS_PER_USER` */
	sseConnectionsPerUser: number | null;
	/** Accounts on the instance, all together; sign-up is refused at the limit. `QUOTA_ACCOUNTS_TOTAL` */
	accountsTotal: number | null;
	/** New accounts created in the last 24 hours, all together. `QUOTA_SIGNUPS_PER_DAY` */
	signupsPerDay: number | null;
	/** Chapters one user may be a member of (created or joined). `QUOTA_MEMBERSHIPS_PER_USER` */
	membershipsPerUser: number | null;
	/** File uploads one user may have in flight at once. `QUOTA_CONCURRENT_UPLOADS_PER_USER` */
	concurrentUploadsPerUser: number | null;
}

type CountKey = Exclude<keyof Quotas, 'uploadBytesPerWorkspace' | 'uploadBytesPerUser'>;

/** Variable name, selfhost default, public default. */
const QUOTA_COUNTS: Record<CountKey, [string, number | null, number]> = {
	buildsPerWorkspace: ['QUOTA_BUILDS_PER_WORKSPACE', null, 10],
	draftsPerUser: ['QUOTA_DRAFTS_PER_USER', null, 20],
	chaptersPerUser: ['QUOTA_CHAPTERS_PER_USER', null, 3],
	membersPerChapter: ['QUOTA_MEMBERS_PER_CHAPTER', null, 25],
	pendingInvitesPerChapter: ['QUOTA_PENDING_INVITES_PER_CHAPTER', null, 25],
	photosPerBuild: ['QUOTA_PHOTOS_PER_BUILD', null, 100],
	kitCopiesPerWorkspace: ['QUOTA_KIT_COPIES_PER_WORKSPACE', null, 2],
	customFilamentsPerWorkspace: ['QUOTA_CUSTOM_FILAMENTS_PER_WORKSPACE', null, 50],
	savedDesignsPerUser: ['QUOTA_SAVED_DESIGNS_PER_USER', null, 50],
	stepConversionsPerUser: ['QUOTA_STEP_CONVERSIONS_PER_USER', null, 1],
	sseConnectionsPerUser: ['QUOTA_SSE_CONNECTIONS_PER_USER', null, 12],
	accountsTotal: ['QUOTA_ACCOUNTS_TOTAL', null, 500],
	signupsPerDay: ['QUOTA_SIGNUPS_PER_DAY', null, 50],
	membershipsPerUser: ['QUOTA_MEMBERSHIPS_PER_USER', null, 10],
	concurrentUploadsPerUser: ['QUOTA_CONCURRENT_UPLOADS_PER_USER', null, 2]
};
const QUOTA_UPLOAD_VAR = 'QUOTA_UPLOAD_MB_PER_WORKSPACE';
const QUOTA_UPLOAD_PUBLIC_MB = 2048;
const QUOTA_UPLOAD_USER_VAR = 'QUOTA_UPLOAD_MB_PER_USER';
const QUOTA_UPLOAD_USER_PUBLIC_MB = 4096;

/** `off` (also `unlimited`, `none`) is null; digits are that number (0 forbids the thing); empty is `fallback`; anything else throws. */
function quotaValue(name: string, fallback: number | null): number | null {
	const raw = (env[name] ?? '').trim().toLowerCase();
	if (!raw) return fallback;
	if (raw === 'off' || raw === 'unlimited' || raw === 'none') return null;
	if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
		throw new Error(`${name} must be a whole number (0 or more) or "off", got "${env[name]}".`);
	}
	return Number(raw);
}

export function quotas(): Quotas {
	const pub = isPublicMode();
	const out = {} as Quotas;
	for (const [key, [name, selfhost, hosted]] of Object.entries(QUOTA_COUNTS) as [
		CountKey,
		[string, number | null, number]
	][]) {
		out[key] = quotaValue(name, pub ? hosted : selfhost);
	}
	const mb = quotaValue(QUOTA_UPLOAD_VAR, pub ? QUOTA_UPLOAD_PUBLIC_MB : null);
	out.uploadBytesPerWorkspace = mb === null ? null : mb * 1024 * 1024;
	const userMb = quotaValue(QUOTA_UPLOAD_USER_VAR, pub ? QUOTA_UPLOAD_USER_PUBLIC_MB : null);
	out.uploadBytesPerUser = userMb === null ? null : userMb * 1024 * 1024;
	return out;
}

/**
 * Printers one workspace may have that are reached through an OctoEverywhere shared link
 * (`QUOTA_LINK_PRINTERS_PER_WORKSPACE`, digits or `off`). Default 3 in public mode (each one is a
 * long-lived connection from this server to a third party), no limit self-hosted. Kept apart from
 * `quotas()` on purpose: it is a printer-store rule, enforced in `printers/store.ts`.
 */
export function linkPrintersPerWorkspace(): number | null {
	return quotaValue('QUOTA_LINK_PRINTERS_PER_WORKSPACE', isPublicMode() ? 3 : null);
}

/**
 * Link printers on the whole instance (`QUOTA_LINK_PRINTERS_TOTAL`, digits or `off`): every one is
 * a long-lived connection from this server to a third party. Default 200 in public mode, no limit
 * self-hosted. Enforced in `printers/store.ts` with the per-workspace cap.
 */
export function linkPrintersTotal(): number | null {
	return quotaValue('QUOTA_LINK_PRINTERS_TOTAL', isPublicMode() ? 200 : null);
}

/**
 * Not-connected (manual) printers per workspace (`QUOTA_MANUAL_PRINTERS_PER_WORKSPACE`, digits or
 * `off`): they cost no connection, only rows. Default 10 in public mode, no limit self-hosted.
 */
export function manualPrintersPerWorkspace(): number | null {
	return quotaValue('QUOTA_MANUAL_PRINTERS_PER_WORKSPACE', isPublicMode() ? 10 : null);
}

/** Validates `WRITE_RATE_PER_MIN` and `WRITE_RATE_BURST` (digits or `off`) at boot; `write-rate.ts` does the parsing for use. */
function writeRateVars(): void {
	quotaValue('WRITE_RATE_PER_MIN', null);
	quotaValue('WRITE_RATE_BURST', null);
}

/** Default free space to keep on the data volume in public mode, in MB. */
const MIN_FREE_DISK_PUBLIC_MB = 2048;

/**
 * Free space (bytes) the data volume must keep before uploads are accepted: `MIN_FREE_DISK_MB`
 * (digits, or `off`/`0`), default 0 (off) in selfhost and 2048 MB in public mode. 0 means off.
 */
export function minFreeDiskBytes(): number {
	const mb = quotaValue('MIN_FREE_DISK_MB', isPublicMode() ? MIN_FREE_DISK_PUBLIC_MB : 0);
	return (mb ?? 0) * 1024 * 1024;
}

/**
 * True when the volume holding `dir` has at least `minFreeDiskBytes()` free. Also true when the
 * limit is off or the free space cannot be read (statfs missing or failing), so a platform quirk
 * never blocks uploads. Upload routes answer 507 when this is false.
 */
export function diskHasRoom(dir: string = dataDir()): boolean {
	const min = minFreeDiskBytes();
	if (min <= 0) return true;
	try {
		const st = statfsSync(dir);
		return Number(st.bavail) * Number(st.bsize) >= min;
	} catch {
		return true;
	}
}
