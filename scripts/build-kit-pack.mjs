// Maintainer tool: build a kit pack (see docs/kit-pack.md) from MakeGood's files, or from a
// database + uploads directory that already holds the imported kit. Runs in the app image
// (the code it uses is bundled into build/cli by `npm run build`), from the app root.
//
//   # one go, scratch install (later --print files win):
//   node scripts/build-kit-pack.mjs --db data/kitpack-work/tmt.db --init \
//     --model "STEP FILES.zip" --hardware hardware.glb \
//     --print h-profile.3mf --print bucket.3mf --print harness.zip --print xpa.3mf \
//     --pack-version 1.0.0 --out data/kitpack
//
//   # or only pack what an install already has:
//   node scripts/build-kit-pack.mjs --db /data/tmt.db --pack-version 1.0.0 --out /tmp
//
//   # a part without a STEP file (community design from a slicer 3MF) is added to the model
//   # as a node in its own frame (see src/lib/server/kitpack/model-node.ts), then packed:
//   node scripts/build-kit-pack.mjs --db data/kitpack-work/tmt.db --pack-version 1.0.2 --out data/kitpack \
//     --print SinglePieceHandleTMT.3mf --model-node push-handle-one-piece=SinglePieceHandleTMT.3mf \
//     --project-settings push-handle-one-piece=SinglePieceHandleTMT.3mf \
//     --origins-from kitpacks/makegood-tmt-revb-1.0.1.kitpack
//
// Parts under another license than MakeGood's CC0 are listed in kitpacks/licenses.json (manifest
// `otherLicenses` and CREDITS.md); `--licenses <file>` picks another file.
//
// Writes <out>/<template>-<version>.kitpack and prints its size and sha256 (for
// kitpacks/index.json). Never commit the pack.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { strFromU8, unzipSync } from 'fflate';

const usage = `Usage: build-kit-pack.mjs --db <path> --pack-version <x.y.z> --out <dir> [--template <slug>]
  [--init] [--model <step.zip>] [--hardware <hardware.glb>] [--print <3mf|zip>]... [--scale 1000]
  [--license-url <url>] [--import-only] [--model-node <slug>=<3mf>]... [--project-settings <slug>=<3mf>]... [--origins-from <older.kitpack>] [--licenses <json>]`;

let args;
try {
	args = parseArgs({
		options: {
			db: { type: 'string' },
			template: { type: 'string', default: 'makegood-tmt-revb' },
			init: { type: 'boolean', default: false },
			model: { type: 'string' },
			hardware: { type: 'string' },
			print: { type: 'string', multiple: true },
			'pack-version': { type: 'string' },
			out: { type: 'string' },
			scale: { type: 'string', default: '1000' },
			'license-url': { type: 'string' },
			'model-node': { type: 'string', multiple: true },
			'project-settings': { type: 'string', multiple: true },
			'origins-from': { type: 'string' },
			licenses: { type: 'string' },
			'import-only': { type: 'boolean', default: false },
			help: { type: 'boolean', default: false }
		}
	}).values;
} catch (e) {
	console.error(e.message + '\n' + usage);
	process.exit(2);
}
if (args.help || !args.db || (!args['import-only'] && (!args['pack-version'] || !args.out))) {
	console.log(usage);
	process.exit(args.help ? 0 : 2);
}

const dbPath = resolve(args.db);
// uploadsDir() is derived from DATABASE_URL, so set it before the bundle runs.
process.env.DATABASE_URL = dbPath;
let cli;
try {
	cli = await import(new URL('../build/cli/kitpack-cli.js', import.meta.url));
} catch (e) {
	console.error(
		`Cannot load build/cli/kitpack-cli.js (${e.code ?? e.message}). Run \`npm run build\` first.`
	);
	process.exit(1);
}

try {
	if (!args.init && !existsSync(dbPath))
		throw new Error(`Database ${dbPath} does not exist (use --init)`);
	const db = cli.openDb(dbPath);
	if (args.init) cli.initDb(db);
	const tpl = cli.findTemplate(db, args.template);
	const t0 = Date.now();
	const step = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
	if (args.model) {
		let last = -10;
		const r = await cli.convertModel(db, tpl.id, resolve(args.model), (pct, msg) => {
			if (pct - last >= 10) {
				last = pct;
				step(`model ${pct}% ${msg}`);
			}
		});
		step(`model: ${r.slugs} parts, ${r.missing} missing, ${r.failed} failed`);
	}
	if (args.hardware)
		step(`hardware GLB: ${cli.registerHardware(tpl.id, resolve(args.hardware))} bytes`);
	for (const f of args.print ?? []) {
		for (const { file, result } of await cli.importFiles(db, tpl.id, [resolve(f)])) {
			step(`${file.split('/').pop()}: imported ${result.imported} part(s)`);
			for (const r of result.report) {
				if (r.unmatched.length)
					console.log(`    ${r.file}: ${r.unmatched.length} unmatched objects`);
				for (const w of r.warnings) console.log(`    warning: ${w}`);
			}
		}
	}
	for (const spec of args['model-node'] ?? []) {
		const eq = spec.indexOf('=');
		if (eq < 1) throw new Error(`--model-node expects <slug>=<file.3mf>, got "${spec}"`);
		const slug = spec.slice(0, eq);
		const r = await cli.addModelNodeFrom3mf(db, tpl.id, slug, resolve(spec.slice(eq + 1)), step);
		const f = (a) => a.map((v) => v.toFixed(1)).join(' ');
		step(
			`model node ${slug}: box min [${f(r.box.min)}] max [${f(r.box.max)}], ${r.slugs.length} nodes`
		);
	}
	for (const spec of args['project-settings'] ?? []) {
		const eq = spec.indexOf('=');
		if (eq < 1) throw new Error(`--project-settings expects <slug>=<file.3mf>, got "${spec}"`);
		const slug = spec.slice(0, eq);
		const kept = cli.applyProjectSettings(db, tpl.id, slug, resolve(spec.slice(eq + 1)));
		step(`print settings of ${slug}: ${JSON.stringify(kept)}`);
	}
	if (args['import-only']) process.exit(0);
	const out = resolve(args.out);
	mkdirSync(out, { recursive: true });
	const version = args['pack-version'];
	const outFile = `${out}/${tpl.slug}-${version}.kitpack`;
	const defaultLicenses = fileURLToPath(new URL('../kitpacks/licenses.json', import.meta.url));
	const licensesFile = args.licenses ? resolve(args.licenses) : defaultLicenses;
	let otherLicenses;
	if (existsSync(licensesFile))
		otherLicenses = JSON.parse(readFileSync(licensesFile, 'utf8')).otherLicenses;
	else if (args.licenses) throw new Error(`--licenses file ${licensesFile} does not exist`);
	else
		console.error(
			`WARNING: ${defaultLicenses} not found: the pack gets no otherLicenses notices (community parts would be credited as CC0)`
		);
	const originsFrom = args['origins-from']
		? Object.fromEntries(
				JSON.parse(
					strFromU8(
						unzipSync(new Uint8Array(readFileSync(resolve(args['origins-from']))), {
							filter: (f) => f.name === 'print/geometry.json'
						})['print/geometry.json']
					)
				).map((r) => [r.slug, r.origin])
			)
		: undefined;
	const res = cli.buildKitPack(db, {
		templateSlug: tpl.slug,
		version,
		outFile,
		scale: Number(args.scale),
		licenseUrl: args['license-url'],
		otherLicenses,
		originsFrom,
		log: step
	});
	step(`wrote ${outFile}`);
	console.log(
		JSON.stringify(
			{
				file: outFile,
				size: statSync(outFile).size,
				sha256: res.sha256,
				contents: res.manifest.contents,
				maxQuantErrorMm: res.maxQuantError,
				droppedSettingKeys: res.droppedSettings
			},
			null,
			2
		)
	);
} catch (e) {
	console.error('Error: ' + (e?.stack ?? e));
	process.exit(1);
}
