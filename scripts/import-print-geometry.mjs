// Import print geometry (the MakeGood profile 3MF, or a zip of 3MFs) for a kit without the
// browser upload: the same code as the kit admin page ("Print geometry"), for big files.
// Run inside the app container (the code it uses is bundled into build/cli by `npm run build`):
//
//   node scripts/import-print-geometry.mjs --list [--db /data/tmt.db]
//   node scripts/import-print-geometry.mjs --db /data/tmt.db --template tmt \
//     --file /import/profile.3mf [--file /import/harness.zip]
//
// Meshes are written next to the database (<db dir>/uploads/print/<template>/). Stop nothing:
// the running app picks the rows up on the next request. `--init` migrates and seeds a brand
// new database first (scratch copies); the app does that itself at start.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const usage = `Usage:
  import-print-geometry.mjs --list [--db <path>]
  import-print-geometry.mjs --template <slug> --file <profile.3mf|zip> [--file <more>] [--db <path>] [--init]`;

let args;
try {
	args = parseArgs({
		options: {
			db: { type: 'string' },
			template: { type: 'string' },
			file: { type: 'string', multiple: true },
			init: { type: 'boolean', default: false },
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

const dbPath = resolve(args.db || process.env.DATABASE_URL || '/data/tmt.db');
// uploadsDir() is derived from DATABASE_URL, so set it before the bundle runs.
process.env.DATABASE_URL = dbPath;
let cli;
try {
	cli = await import(new URL('../build/cli/geometry-cli.js', import.meta.url));
} catch (e) {
	console.error(
		`Cannot load build/cli/geometry-cli.js (${e.code ?? e.message}). Run \`npm run build\` first.`
	);
	process.exit(1);
}

try {
	if (!args.init && !existsSync(dbPath))
		throw new Error(`Database ${dbPath} does not exist (use --init for a new one)`);
	const db = cli.openDb(dbPath);
	if (args.init) cli.initDb(db);
	if (args.list || !args.file?.length) {
		if (!args.list) throw new Error('--file is required\n' + usage);
		for (const t of cli.listTemplates(db)) {
			const rows = cli.listPrintGeometry(db, t.id);
			const mesh = rows.filter((r) => r.hasMesh && r.source !== 'seed').length;
			console.log(
				`template ${t.slug}  ${t.name}  (${mesh}/${rows.length} parts with imported geometry)`
			);
		}
		process.exit(0);
	}
	if (!args.template) throw new Error('--template is required\n' + usage);
	const tpl = cli.findTemplate(db, args.template);
	for (const f of args.file) if (!existsSync(f)) throw new Error(`File not found: ${f}`);
	const t0 = Date.now();
	for (const { file, result } of await cli.importFiles(db, tpl.id, args.file)) {
		console.log(`${file}: imported ${result.imported} part(s)`);
		for (const r of result.report) {
			console.log(
				`  ${r.file}: matched ${r.matched} (${r.ms} ms)${r.parts.length ? ' -> ' + r.parts.join(', ') : ''}`
			);
			if (r.unmatched.length) console.log(`    unmatched objects: ${r.unmatched.length}`);
			for (const w of r.warnings) console.log('    warning: ' + w);
		}
	}
	const rows = cli.listPrintGeometry(db, tpl.id);
	console.log(
		`done in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${rows.filter((r) => r.hasMesh && r.source !== 'seed').length} of ${rows.length} parts of ${tpl.slug} have print geometry`
	);
} catch (e) {
	console.error('Error: ' + (e?.message ?? e));
	process.exit(1);
}
