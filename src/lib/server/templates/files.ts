import { readdirSync, statSync } from 'node:fs';
import { rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { templateHardwarePath, templateModelPath, uploadsDir } from '../config';
import type { Db } from '../db';
import { templateModelJobs, templates } from '../db/schema';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Every on-disk location a template owns: model, hardware GLB, print meshes, guide images. */
function templateFileRoots(templateId: string): { files: string[]; dirs: string[] } {
	return {
		files: [templateModelPath(templateId), templateHardwarePath(templateId)],
		dirs: [join(uploadsDir(), 'print', templateId), join(uploadsDir(), 'guide', templateId)]
	};
}

function dirBytes(dir: string): number {
	let total = 0;
	let entries: import('node:fs').Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) total += dirBytes(p);
		else
			try {
				total += statSync(p).size;
			} catch {
				/* vanished */
			}
	}
	return total;
}

/**
 * Bytes on disk of the kit files (model, hardware GLB, print meshes, guide images) of the copies a
 * workspace owns, measured from the files, never from stored sizes. Synchronous (call it inside
 * the transaction that inserts, like the other quota counters).
 */
export function kitCopyBytes(db: Db, orgId: string): number {
	const ids = db
		.select({ id: templates.id })
		.from(templates)
		.where(eq(templates.ownerOrgId, orgId))
		.all();
	let total = 0;
	for (const { id } of ids) {
		if (!SAFE_ID.test(id)) continue;
		const { files, dirs } = templateFileRoots(id);
		for (const f of files)
			try {
				total += statSync(f).size;
			} catch {
				/* absent */
			}
		for (const d of dirs) total += dirBytes(d);
	}
	return total;
}

/**
 * Deletes a template's files from disk (model, hardware GLB, print meshes, guide images and, when
 * `db` is given, the queued STEP zips of its conversion jobs). Does not touch database rows:
 * call it BEFORE deleting the workspace or template (rows cascade), never for a built-in kit.
 * Never throws for missing files.
 */
export async function removeTemplateFiles(templateId: string, db?: Db): Promise<void> {
	if (!SAFE_ID.test(templateId)) return;
	const { files, dirs } = templateFileRoots(templateId);
	if (db)
		for (const j of db
			.select({ p: templateModelJobs.inputPath })
			.from(templateModelJobs)
			.where(eq(templateModelJobs.templateId, templateId))
			.all())
			await unlink(j.p).catch(() => {});
	for (const f of files) await rm(f, { force: true }).catch(() => {});
	for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
}

/** Removes the files of every kit copy a workspace owns (chapter or account deletion). Returns the template ids. */
export async function removeWorkspaceTemplateFiles(db: Db, orgId: string): Promise<string[]> {
	const ids = db
		.select({ id: templates.id })
		.from(templates)
		.where(eq(templates.ownerOrgId, orgId))
		.all()
		.map((r) => r.id);
	for (const id of ids) await removeTemplateFiles(id, db);
	return ids;
}
