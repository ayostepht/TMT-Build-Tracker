// Runs only when TMT_XPA_3MF points at the X/P/A project 3MF (never in git, never in CI).
// Checks that parts keep their source layout as groups and that objects are filed under the right part.
import { createReadStream, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tmtTemplate } from '../seed/tmt';
import { extractPartGeometry } from './extract';

const file = process.env.TMT_XPA_3MF;

describe.skipIf(!file || !existsSync(file))('source groups of the real X/P/A project', () => {
	it(
		'files the straps under the harness and keeps plate layouts as groups',
		{ timeout: 600_000 },
		async () => {
			const parts = tmtTemplate.parts.map((p) => ({
				slug: p.slug,
				name: p.name,
				sourceFile: p.sourceFile,
				notes: p.notes,
				allowedMaterials: p.allowedMaterials,
				components: p.components,
				qty: p.qty
			}));
			const res = await extractPartGeometry(
				() => createReadStream(file!, { highWaterMark: 1 << 20 }),
				parts
			);
			const by = new Map(res.parts.map((p) => [p.slug, p]));
			const footrest = by.get('footrest')!;
			expect(footrest.pieces.map((p) => p.name)).toEqual(['3DTMT I FOOTREST COMBINED REV A.STEP']);
			expect(footrest.groups).toBeUndefined();
			expect(by.get('push-grip')!.pieces[0].name).toBe('MG_PUSH HANDLE.step');
			expect(by.get('push-top')!.pieces).toHaveLength(1);
			const harness = by.get('harness')!;
			expect(harness.pieces.map((p) => p.name)).toContain('3DTMT - FOOTREST STRAP');
			expect(harness.groups).toHaveLength(1);
			expect(harness.groups![0].items).toHaveLength(15);
			expect(harness.groups![0].bed).toEqual({ x: 256, y: 256 });
			expect(by.get('tires')!.groups![0].items).toHaveLength(8);
			expect(by.get('connectors')!.groups![0].items).toHaveLength(24);
			expect(by.get('buckles')!.groups![0].items).toHaveLength(23);
		}
	);
});
