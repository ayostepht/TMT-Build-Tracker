import { sql } from 'drizzle-orm';
import type { Db } from '../db';

/**
 * Gives every build a `build_parts` row for every part of its template. Builds made
 * before a part existed (e.g. variant parts added to the seed later) get the new rows
 * with default state, so switching variants never loses or lacks progress rows.
 * Idempotent; returns the number of rows added. Called at startup after seeding.
 */
export function backfillBuildParts(db: Db): number {
	const res = db.run(sql`
		INSERT INTO build_parts (build_id, part_slug)
		SELECT b.id, tp.slug
		FROM builds b
		JOIN template_parts tp ON tp.template_id = b.template_id
		WHERE NOT EXISTS (
			SELECT 1 FROM build_parts bp WHERE bp.build_id = b.id AND bp.part_slug = tp.slug
		)
	`);
	return res.changes;
}
