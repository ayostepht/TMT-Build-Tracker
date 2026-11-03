// Test-only: registers synthetic print geometry (boxes, no MakeGood data) for a few parts straight
// in the e2e database and uploads directory, the same rows and files the kit admin import writes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { encodeMesh } from '../src/lib/server/print-geometry/mesh-format';

const DB = 'data/e2e/tmt.db';
const UPLOADS = 'data/e2e/uploads';

export const SYNTHETIC: Record<string, [number, number, number]> = {
	'wing-left': [200, 80, 20],
	'wing-right': [200, 80, 20],
	footrest: [180, 120, 30],
	'push-pin': [12, 12, 40]
};

function box(w: number, d: number, h: number) {
	const x = w / 2;
	const y = d / 2;
	return {
		positions: new Float32Array([
			-x,
			-y,
			0,
			x,
			-y,
			0,
			x,
			y,
			0,
			-x,
			y,
			0,
			-x,
			-y,
			h,
			x,
			-y,
			h,
			x,
			y,
			h,
			-x,
			y,
			h
		]),
		indices: new Uint32Array([
			0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
			0, 4, 3, 4, 7
		])
	};
}

/** Rows (e.g. seed footprints) the synthetic geometry replaced, restored by removeSyntheticGeometry. */
const replaced: Record<string, unknown>[] = [];

/** Returns the template id the geometry was registered for. */
export function registerSyntheticGeometry(): string {
	const db = new Database(DB);
	try {
		const tpl = db.prepare('select id from templates limit 1').get() as { id: string };
		const dir = join(UPLOADS, 'print', tpl.id);
		mkdirSync(dir, { recursive: true });
		const existing = db.prepare(
			`select * from template_print_geometry where template_id = ? and slug = ? and source_note != 'synthetic-e2e.3mf'`
		);
		for (const slug of Object.keys(SYNTHETIC)) {
			const row = existing.get(tpl.id, slug) as Record<string, unknown> | undefined;
			if (row) replaced.push(row);
		}
		const upsert = db.prepare(
			`insert or replace into template_print_geometry
			 (template_id, slug, footprint, hull, height, tris, settings, mesh_path, source_note, updated_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		for (const [slug, [w, d, h]] of Object.entries(SYNTHETIC)) {
			const file = `${slug}.bin`;
			writeFileSync(join(dir, file), encodeMesh(box(w, d, h)));
			const hull = [
				[-w / 2, -d / 2],
				[w / 2, -d / 2],
				[w / 2, d / 2],
				[-w / 2, d / 2]
			];
			const settings = { wall_loops: '4', sparse_infill_density: '20%', enable_support: '0' };
			const footprint = {
				slug,
				unitsPerPlate: 1,
				pieces: [{ name: slug, w, d, h, copies: 1, hull, tris: 12, mesh: file, settings }]
			};
			upsert.run(
				tpl.id,
				slug,
				JSON.stringify(footprint),
				JSON.stringify(hull),
				h,
				12,
				JSON.stringify(settings),
				`print/${tpl.id}/${file}`,
				'synthetic-e2e.3mf',
				Date.now()
			);
		}
		return tpl.id;
	} finally {
		db.close();
	}
}

/**
 * Puts back the rows the synthetic geometry replaced. The e2e database is shared by every spec,
 * and the seed footprints live in the same table (other specs, e.g. printer-arrange, rely on the
 * real wing size not fitting a 256 mm bed), so deleting isn't enough: restore the originals.
 */
export function removeSyntheticGeometry(): void {
	const db = new Database(DB);
	try {
		db.prepare(`delete from template_print_geometry where source_note = 'synthetic-e2e.3mf'`).run();
		const insert = db.prepare(
			`insert or replace into template_print_geometry
			 (template_id, slug, footprint, hull, height, tris, settings, mesh_path, source_note, updated_at)
			 values (@template_id, @slug, @footprint, @hull, @height, @tris, @settings, @mesh_path, @source_note, @updated_at)`
		);
		for (const row of replaced.splice(0)) insert.run(row);
	} finally {
		db.close();
	}
}
