import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
// Runtime configuration read from environment variables. Kept free of SvelteKit
// imports so it can be used from tests and tooling.
const env = process.env;
const isProd = env.NODE_ENV === 'production';

export function databaseUrl(): string {
	return env.DATABASE_URL || (isProd ? '/data/tmt.db' : './data/tmt.db');
}

/**
 * Public URL of the app (`PUBLIC_URL`, or the older `BETTER_AUTH_URL` / `ORIGIN`),
 * normalised to an origin with no trailing slash. Returns null when unset, in
 * which case the origin is taken from each request (see scripts/proxy-origin.mjs).
 */
export function publicUrl(): string | null {
	const raw = (env.PUBLIC_URL || env.BETTER_AUTH_URL || env.ORIGIN || '').trim();
	if (!raw) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`PUBLIC_URL is not a valid URL: ${raw}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`PUBLIC_URL must start with http:// or https://: ${raw}`);
	}
	return url.origin;
}

const DEV_SECRET = 'dev-only-insecure-secret-change-me-0123456789';
const WEAK_SECRETS = new Set(['change-me', 'changeme', 'secret', 'password', DEV_SECRET]);
const MIN_SECRET_LENGTH = 32;

/**
 * Signing/encryption secret (`BETTER_AUTH_SECRET`). In production it must be set, at least
 * 32 characters and not a known placeholder. Outside production (and while `npm run build`
 * runs) a fixed dev fallback is used. Error messages never include the secret itself.
 */
export function authSecret(): string {
	const secret = env.BETTER_AUTH_SECRET;
	const enforce = isProd && env.npm_lifecycle_event !== 'build';
	if (!secret) {
		if (enforce) {
			throw new Error(
				'BETTER_AUTH_SECRET must be set in production (generate one with `openssl rand -hex 32`).'
			);
		}
		return DEV_SECRET;
	}
	if (enforce) {
		if (secret.length < MIN_SECRET_LENGTH) {
			throw new Error(
				`BETTER_AUTH_SECRET is too short (${secret.length} characters, need at least ${MIN_SECRET_LENGTH}). Generate one with \`openssl rand -hex 32\`.`
			);
		}
		if (WEAK_SECRETS.has(secret.trim().toLowerCase())) {
			throw new Error(
				'BETTER_AUTH_SECRET is a well-known placeholder. Generate a real one with `openssl rand -hex 32`.'
			);
		}
	}
	return secret;
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
 * separate variable. Null means no trusted header: `getClientAddress()` is the socket address
 * and a client-sent `X-Forwarded-For` must be ignored.
 */
export function trustedProxy(): TrustedProxy | null {
	const header = (env.ADDRESS_HEADER ?? '').trim().toLowerCase();
	if (!header) return null;
	const raw = (env.XFF_DEPTH ?? '').trim();
	const xffDepth = raw ? Number(raw) : 1;
	if (!Number.isInteger(xffDepth) || xffDepth < 1) {
		throw new Error(`XFF_DEPTH must be a positive integer, got "${raw}".`);
	}
	return { header, xffDepth };
}

/** Problems that make `TMT_MODE=public` unsafe to start; empty when fine or not in public mode. */
export function validatePublicMode(): string[] {
	if (!isPublicMode()) return [];
	const problems: string[] = [];
	let url: string | null = null;
	try {
		url = publicUrl();
	} catch (e) {
		problems.push((e as Error).message);
	}
	if (!url) {
		if (problems.length === 0) problems.push('PUBLIC_URL must be set in public mode.');
	} else if (!url.startsWith('https://')) {
		problems.push('PUBLIC_URL must be an https:// address in public mode.');
	}
	try {
		if (Object.keys(socialProviders()).length === 0) {
			problems.push(
				'Public mode needs at least one sign-in provider: set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET or GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET.'
			);
		}
	} catch (e) {
		problems.push((e as Error).message);
	}
	return problems;
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

/** Largest 3MF upload in bytes: `MAX_3MF_MB`, default 1024. Sliced projects with G-code for every plate reach several hundred MB. */
export function maxThreeMfBytes(): number {
	const mb = Number(process.env.MAX_3MF_MB);
	return (Number.isFinite(mb) && mb > 0 ? mb : 1024) * 1024 * 1024;
}
