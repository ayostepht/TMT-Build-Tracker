// Runs only when MAKEGOOD_STEP_ZIP points at MakeGood's STEP zip (never in git, never in CI).
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { templateModelPath } from '../config';
import { convertStepZip } from './convert';

const zip = process.env.MAKEGOOD_STEP_ZIP;

describe.skipIf(!zip || !existsSync(zip))('convertStepZip (real STEP zip)', () => {
	it(
		'builds a GLB with one node per slug from a few small parts',
		{ timeout: 120_000 },
		async () => {
			process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-conv-')), 't.db');
			const progress: number[] = [];
			const res = await convertStepZip(
				zip!,
				{
					id: 'tpl-test',
					parts: [
						{ slug: 'hub-caps', sourceFile: '3DTMT S BOLT CAP REV A.STEP', components: [] },
						{ slug: 'headrest-bolt', sourceFile: 'MG_HEADREST SCREW REV B', components: [] },
						{
							slug: 'connectors',
							sourceFile: 'Multiple files, see checklist',
							components: [
								{ file: '3DTMT 4MM WASHER.step' },
								{ file: '3DTMT Q WHEEL PIN REV A.STEP' }
							]
						},
						{ slug: 'lid', sourceFile: 'MakerWorld 3mf only (not in STEP pack)', components: [] }
					]
				},
				(p) => progress.push(p)
			);
			expect(res.slugs.sort()).toEqual(['connectors', 'headrest-bolt', 'hub-caps']);
			expect(res.report.find((r) => r.slug === 'lid')?.status).toBe('missing');
			expect(res.report.some((r) => r.status === 'skipped' && /assembly/i.test(r.file))).toBe(true);
			expect(progress.at(-1)).toBeGreaterThan(90);
			const path = templateModelPath('tpl-test');
			expect(statSync(path).size).toBe(res.size);
			await MeshoptDecoder.ready;
			const doc = await new NodeIO()
				.registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
				.registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
				.read(path);
			expect(
				doc
					.getRoot()
					.listNodes()
					.map((n) => n.getName())
					.sort()
			).toEqual(['connectors', 'headrest-bolt', 'hub-caps']);
		}
	);
});
