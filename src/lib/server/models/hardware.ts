import { statSync } from 'node:fs';
import { templateHardwarePath } from '../config.ts';

/** URL of the optional hardware GLB when one has been uploaded (cache-busted by file mtime), else null. */
export function hardwareModelUrl(templateId: string): string | null {
	try {
		const s = statSync(templateHardwarePath(templateId));
		if (!s.isFile()) return null;
		return `/api/templates/${encodeURIComponent(templateId)}/hardware.glb?v=${Math.floor(s.mtimeMs).toString(36)}`;
	} catch {
		return null;
	}
}
