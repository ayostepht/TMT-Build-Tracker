// Import progress from the original single-page prototype into a build.
// Run inside the app container (the code it uses is bundled into build/cli by `npm run build`):
//
//   node --import ./scripts/proxy-origin.mjs scripts/import-prototype.mjs --list
//   node --import ./scripts/proxy-origin.mjs scripts/import-prototype.mjs \
//     --db /data/tmt.db --file export.json --build <id> [--replace] [--dry-run]
//   node --import ./scripts/proxy-origin.mjs scripts/import-prototype.mjs \
//     --db /data/tmt.db --file export.json --new "My chair" --workspace <id-or-slug> --design <slug>
//
// Make export.json with scripts/bundle-prototype-export.mjs. Activity rows from here have no user.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const usage = `Usage:
  import-prototype.mjs --list [--db <path>]
  import-prototype.mjs --file <export.json> (--build <id> | --new "<name>" --workspace <id-or-slug> --design <design-slug>)
                       [--db <path>] [--replace] [--dry-run]`;

let args;
try {
	args = parseArgs({
		options: {
			db: { type: 'string' },
			file: { type: 'string' },
			build: { type: 'string' },
			new: { type: 'string' },
			workspace: { type: 'string' },
			design: { type: 'string' },
			replace: { type: 'boolean', default: false },
			'dry-run': { type: 'boolean', default: false },
			list: { type: 'boolean', default: false },
			help: { type: 'boolean', default: false }
		}
	}).values;
} catch (e) {
	console.error(e.message + '\n' + usage);
	process.exit(2);
}
if (args.help) {
	console.log(usage);
	process.exit(0);
}

const dbPath = args.db || process.env.DATABASE_URL || '/data/tmt.db';
let cli;
try {
	cli = await import(new URL('../build/cli/import-cli.js', import.meta.url));
} catch (e) {
	console.error(
		`Cannot load build/cli/import-cli.js (${e.code ?? e.message}). Run \`npm run build\` first.`
	);
	process.exit(1);
}

try {
	const db = cli.openDb(dbPath);
	if (args.list) {
		for (const w of cli.listWorkspaces(db)) {
			console.log(`workspace ${w.id}  ${w.name}  (${w.slug})`);
			for (const b of w.builds) console.log(`  build ${b.id}  ${b.name}`);
		}
		process.exit(0);
	}
	if (!args.file) throw new Error('--file is required\n' + usage);
	if (!args.build && !args.new)
		throw new Error('Give --build, or --new with --workspace and --design\n' + usage);
	if (args.build && args.new) throw new Error('Use either --build or --new, not both');
	if (args.new && (!args.workspace || !args.design))
		throw new Error('--new needs --workspace and --design');
	let data;
	try {
		data = JSON.parse(readFileSync(args.file, 'utf8'));
	} catch (e) {
		throw new Error(`Cannot read ${args.file}: ${e.message}`, { cause: e });
	}
	const { buildId, result } = cli.runImport(
		db,
		args.build
			? { buildId: args.build }
			: { newBuild: { name: args.new, workspace: args.workspace, design: args.design } },
		data,
		{ replace: args.replace, dryRun: args['dry-run'] }
	);
	console.log(args['dry-run'] ? 'Dry run, nothing was written.' : 'Imported.');
	if (buildId) console.log(`build: ${buildId}`);
	console.log(
		`parts: ${result.parts}  runs: ${result.runs}  plates with slicer weights: ${result.plates}  spool roles: ${result.spools}`
	);
	if (result.warnings.length) {
		console.log(`warnings (${result.warnings.length}):`);
		for (const w of result.warnings) console.log('  - ' + w);
	}
} catch (e) {
	console.error('Error: ' + (e?.message ?? e));
	process.exit(1);
}
