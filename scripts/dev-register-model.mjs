#!/usr/bin/env node
// Dev only: register an existing GLB as a template's 3D model without the STEP zip.
//
//   node scripts/dev-register-model.mjs <db file> <template slug> <model.glb>
//
// Copies the GLB to <db dir>/uploads/models/<templateId>.glb (what the app serves) and
// upserts the template_models row (version = content hash, slugs = node names in the GLB).
// The server must have run once so the schema exists. Never commit the GLB.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [dbFile, templateSlug, glbFile] = process.argv.slice(2);
if (!dbFile || !templateSlug || !glbFile) {
	console.error('usage: dev-register-model.mjs <db file> <template slug> <model.glb>');
	process.exit(2);
}

const glb = readFileSync(glbFile);
if (glb.toString('latin1', 0, 4) !== 'glTF') {
	console.error('Not a GLB file');
	process.exit(1);
}
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLen));
const slugs = [
	...new Set(
		(json.nodes ?? [])
			.filter((n) => n.mesh !== undefined && n.name && !n.name.startsWith('hw:'))
			.map((n) => n.name.replace(/#\d+$/, ''))
	)
];

const db = new Database(resolve(dbFile));
db.pragma('foreign_keys = ON');
const tpl = db.prepare('SELECT id FROM templates WHERE slug = ?').get(templateSlug);
if (!tpl) {
	console.error(`No template with slug "${templateSlug}"`);
	process.exit(1);
}
const dest = join(dirname(resolve(dbFile)), 'uploads', 'models', `${tpl.id}.glb`);
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(glbFile, dest);
const version = createHash('sha256').update(glb).digest('hex').slice(0, 16);
db.prepare(
	`INSERT INTO template_models (template_id, glb_path, version, size, slugs, source_note, created_at)
	 VALUES (?, ?, ?, ?, ?, ?, ?)
	 ON CONFLICT(template_id) DO UPDATE SET glb_path = excluded.glb_path, version = excluded.version,
	   size = excluded.size, slugs = excluded.slugs, source_note = excluded.source_note, created_at = excluded.created_at`
).run(
	tpl.id,
	dest,
	version,
	glb.length,
	JSON.stringify(slugs),
	'registered with dev-register-model.mjs',
	Date.now()
);
console.log(
	`registered ${slugs.length} parts (${(glb.length / 1e6).toFixed(2)} MB, v${version}) for ${templateSlug}`
);
