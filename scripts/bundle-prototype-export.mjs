// Bundle a directory laid out like the original prototype's saved state into one
// file that the app can import (Settings tab, or scripts/import-prototype.mjs).
//
//   node scripts/bundle-prototype-export.mjs <dir> <out.json>
//
// <dir>/parts/<part-id>.json, <dir>/plates/<number>.json, <dir>/settings/filament.json
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
	console.error('Usage: node scripts/bundle-prototype-export.mjs <dir> <out.json>');
	process.exit(2);
}

/** Documents may be wrapped by the storage layer; unwrap `{ value }` / `{ data }`. */
function read(file) {
	const j = JSON.parse(readFileSync(file, 'utf8'));
	for (const k of ['value', 'data'])
		if (j && typeof j === 'object' && !Array.isArray(j) && j[k] && typeof j[k] === 'object')
			return j[k];
	return j;
}

function collect(sub) {
	const d = join(dir, sub);
	const o = {};
	if (!existsSync(d)) return o;
	for (const f of readdirSync(d).sort()) {
		if (f.endsWith('.json')) o[f.slice(0, -5)] = read(join(d, f));
	}
	return o;
}

try {
	const parts = collect('parts');
	const plates = collect('plates');
	const fil = join(dir, 'settings', 'filament.json');
	const data = { format: 'tmt-prototype-v1', parts, plates };
	if (existsSync(fil)) data.settings = { filament: read(fil) };
	writeFileSync(out, JSON.stringify(data));
	console.log(
		`Wrote ${out}: ${Object.keys(parts).length} parts, ${Object.keys(plates).length} plates` +
			(data.settings ? ', filament settings' : '')
	);
} catch (e) {
	console.error('Error: ' + e.message);
	process.exit(1);
}
