import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { uploadsDir } from '../config';

export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

/** `<uploadsDir>/designs/<id>.png`. Ids are UUIDs generated here; anything else is refused. */
export function snapshotPath(designId: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(designId)) throw new Error('bad design id');
	return join(uploadsDir(), 'designs', `${designId}.png`);
}

export async function hasSnapshot(designId: string): Promise<boolean> {
	try {
		return (await stat(snapshotPath(designId))).isFile();
	} catch {
		return false;
	}
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export function isPng(bytes: Uint8Array): boolean {
	return bytes.length > 8 && PNG_MAGIC.every((b, i) => bytes[i] === b);
}

export async function writeSnapshot(designId: string, bytes: Uint8Array): Promise<void> {
	const p = snapshotPath(designId);
	await mkdir(dirname(p), { recursive: true });
	await writeFile(p, bytes);
}

export async function readSnapshot(designId: string): Promise<Buffer | null> {
	try {
		return await readFile(snapshotPath(designId));
	} catch {
		return null;
	}
}

export async function removeSnapshot(designId: string): Promise<void> {
	try {
		await unlink(snapshotPath(designId));
	} catch {
		/* nothing to remove */
	}
}
