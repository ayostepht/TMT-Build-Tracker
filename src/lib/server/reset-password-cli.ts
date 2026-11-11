/**
 * Entry point for `scripts/reset-password-link.mjs`. Bundled by `vite.cli.config.ts` into
 * `build/cli/reset-password-cli.js`. Uses the real config and `createAuth`, but starts no
 * server, seeding or printer supervisor.
 */
import { createAuth } from './auth';
import { databaseUrl, publicUrl } from './config';
import { openDb, runMigrations } from './db';
import { createResetLink, parseOrigin, ResetRefused } from './password-reset';

export { ResetRefused };

/** Prints nothing itself; returns the lines for stdout. */
export async function run(email: string, urlArg: string | undefined): Promise<string[]> {
	if (!urlArg && !publicUrl())
		throw new ResetRefused(
			'PUBLIC_URL is not set: pass --url <origin>, e.g. --url http://192.168.1.10:3000'
		);
	const origin = urlArg ? parseOrigin(urlArg) : (publicUrl() as string);
	const db = openDb(databaseUrl());
	runMigrations(db);
	const link = await createResetLink(db, createAuth(db), email, origin);
	return [link.url, `Expires ${link.expiresAt.toISOString()} (one hour). Works once.`];
}
