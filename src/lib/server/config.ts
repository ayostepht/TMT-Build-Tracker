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

export function authSecret(): string {
	if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
	if (isProd && env.npm_lifecycle_event !== 'build') {
		throw new Error(
			'BETTER_AUTH_SECRET must be set in production (use e.g. `openssl rand -base64 32`).'
		);
	}
	return 'dev-only-insecure-secret-change-me-0123456789';
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
