// Print a one-time password reset link for a self-hosted account (no email is ever sent).
// Run from the app root (migrations load from ./drizzle), with the same environment as the
// server (DATABASE_URL, BETTER_AUTH_SECRET, PUBLIC_URL). The code is bundled into build/cli
// by `npm run build`.
//
//   node scripts/reset-password-link.mjs maker@example.com [--url http://192.168.1.10:3000] [--db /data/tmt.db]
//   docker exec <container> node scripts/reset-password-link.mjs maker@example.com --url https://tmt.example.com
//
// stdout is only the link and its expiry. The link signs the account out everywhere, works
// once and expires in an hour. It is never logged.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const usage = `Usage: reset-password-link.mjs <email> [--url <origin>] [--db <path>]
  --url   app origin (http(s)://host[:port], no path); required unless PUBLIC_URL is set`;

function fail(msg, code = 1) {
	console.error('Error: ' + msg);
	process.exit(code);
}

let parsed;
try {
	parsed = parseArgs({
		options: {
			url: { type: 'string' },
			db: { type: 'string' },
			help: { type: 'boolean', default: false }
		},
		allowPositionals: true
	});
} catch (e) {
	console.error(e.message + '\n' + usage);
	process.exit(2);
}
const { values: args, positionals } = parsed;
if (args.help) {
	console.log(usage);
	process.exit(0);
}
if (positionals.length !== 1) {
	console.error(usage);
	process.exit(2);
}

const dbPath = resolve(args.db || process.env.DATABASE_URL || '/data/tmt.db');
if (!existsSync(dbPath)) fail(`Database ${dbPath} does not exist (set DATABASE_URL or pass --db).`);
process.env.DATABASE_URL = dbPath;

let cli;
try {
	cli = await import(new URL('../build/cli/reset-password-cli.js', import.meta.url));
} catch (e) {
	fail(
		`Cannot load build/cli/reset-password-cli.js (${e.code ?? e.message}). Run \`npm run build\` first.`
	);
}

try {
	for (const line of await cli.run(positionals[0], args.url)) console.log(line);
	process.exit(0);
} catch (e) {
	fail(String(e?.message ?? e).split('\n')[0]);
}
