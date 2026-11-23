/**
 * Custom pieces' plates and thumbnails, for the code that replaces a build's plates.
 *
 * A custom piece's plates (`build_plates.source = 'custom:<pieceId>'`) are the maker's own sliced plates,
 * never arranged or exported with the kit. Every path that deletes the kit's plates and writes new ones
 * (`setPlateLayout`, `applyUpload`, `writePlan`) detaches them first and puts them back after the new
 * kit plates, in their old order. Leaf module: only the database and the file system, so `arrange-plan.ts`
 * and `plates.ts` can both import it.
 */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, max } from 'drizzle-orm';
import { isCustomSource } from '#lib/domain/custom.ts';
import { uploadsDir } from '../config';
import type { Db } from '../db';
import { buildPlates } from '../db/schema';

/** Slug of a part the server generated for a custom piece: `custom-` and 8 hex digits. */
export const CUSTOM_SLUG = /^custom-[0-9a-f]{8}$/;

/** Folder of a build's plate thumbnails, relative to the uploads directory. */
export const plateThumbDir = (buildId: string) => `plates/${buildId}`;

/** Where a custom part's thumbnail is kept, relative to the uploads directory. Recomputed, never trusted from a row. */
export const customThumbRel = (buildId: string, slug: string) =>
	`${plateThumbDir(buildId)}/${slug}.png`;

/**
 * The custom plates of a build are taken out of `build_plates` (so the new kit plates can use any number)
 * and `reattach()` writes them back after the highest number now in the table, in their old order, with
 * every other column as it was (typed time and grams, runs, thumbnail). Call `reattach` after the new plates
 * are inserted. Plate-attached print logs have been turned into part logs by then (`convertPlateRuns`), so
 * renumbering loses nothing; per-part logs of a custom part follow its slug.
 */
export function detachCustomPlates(tx: Db, buildId: string): () => void {
	const rows = tx
		.select()
		.from(buildPlates)
		.where(eq(buildPlates.buildId, buildId))
		.all()
		.filter((r) => isCustomSource(r.source))
		.sort((a, b) => a.number - b.number);
	if (!rows.length) return () => {};
	for (const r of rows)
		tx.delete(buildPlates)
			.where(and(eq(buildPlates.buildId, buildId), eq(buildPlates.number, r.number)))
			.run();
	return () => {
		const top =
			tx
				.select({ n: max(buildPlates.number) })
				.from(buildPlates)
				.where(eq(buildPlates.buildId, buildId))
				.get()?.n ?? 0;
		rows.forEach((r, i) =>
			tx
				.insert(buildPlates)
				.values({ ...r, number: top + 1 + i })
				.run()
		);
	};
}

/**
 * Remove the build's kit plate thumbnails (`<n>.png`) before new plates are written. Custom thumbnails
 * (`custom-<slug>.png`) stay: their plates are put back by `detachCustomPlates`.
 */
export function clearKitThumbs(buildId: string): void {
	const dir = join(uploadsDir(), plateThumbDir(buildId));
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	for (const f of names) if (/^\d+\.png$/.test(f)) rmSync(join(dir, f), { force: true });
}

/** Remove one custom part's thumbnail. */
export function removeCustomThumb(buildId: string, slug: string): void {
	if (!CUSTOM_SLUG.test(slug)) return;
	rmSync(join(uploadsDir(), customThumbRel(buildId, slug)), { force: true });
}

/** Remove a deleted build's plate thumbnails (kit and custom). Call with the access-checked build id, after the delete. */
export function removeBuildPlateFiles(buildId: string): void {
	if (!/^[A-Za-z0-9_-]+$/.test(buildId)) return;
	rmSync(join(uploadsDir(), plateThumbDir(buildId)), { recursive: true, force: true });
}
