import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zipSync, type Zippable } from 'fflate';
import { MAX_STEP_ZIP_ENTRIES, convertStepZipToGlb } from './convert-core.ts';

describe('convertStepZipToGlb entry cap', () => {
	it('refuses a zip with more entries than the cap, with a readable message', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tmt-step-'));
		const files: Zippable = {};
		for (let i = 0; i <= MAX_STEP_ZIP_ENTRIES; i++) files[`s/${i}.step`] = new Uint8Array(0);
		const zipPath = join(dir, 'many.zip');
		writeFileSync(zipPath, zipSync(files));
		await expect(
			convertStepZipToGlb({ zipPath, outPath: join(dir, 'o.glb'), parts: [], onProgress: () => {} })
		).rejects.toThrow(/too many files/);
	});
});
