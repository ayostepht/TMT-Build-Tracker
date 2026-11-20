import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const dir = process.env.KITPACK_DIR;
describe.skipIf(!dir || !existsSync(dir!))('per-plate arrange times on the real kit', () => {
	it('kit plates that are slow to place', { timeout: 600_000 }, async () => {
		process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-real-')), 'real.db');
		const { openDb, runMigrations } = await import('../db');
		const schema = await import('../db/schema');
		const { templateSeeds } = await import('../seed');
		const { seedTemplates } = await import('../seed/run');
		const { installKitPacks } = await import('../kitpack/install');
		const { loadFootprints } = await import('./arrange-plan');
		const db = openDb(':memory:');
		runMigrations(db);
		seedTemplates(db, templateSeeds);
		await installKitPacks(db, { dir: dir!, download: false });
		const tpl = db.select().from(schema.templates).get()!;
		const fps = loadFootprints(db, tpl.id);
		const { arrangeFromSource } = await import('#lib/domain/arrange-source.ts');
		const roles = [
			{ key: 'primary', name: 'Primary', material: 'PETG' },
			{ key: 'accent', name: 'Accent', material: 'PETG' }
		];
		const printer = {
			bedX: 256,
			bedY: 256,
			margin: 1,
			spacing: 8,
			mmSlots: 4,
			keepOut: [{ x: 246, y: 0, w: 10, d: 20 }]
		};
		const mkp = (slug: string, role: string) => ({
			slug,
			name: slug,
			role,
			baseRole: role,
			footprint: fps.get(slug)!,
			units: 1
		});
		for (const [label, slugs, rs] of [
			[
				'headrest (3 parts)',
				['headrest-mount', 'headrest-brace', 'headrest-bolt'],
				['primary', 'primary', 'primary']
			],
			['rims (2 parts)', ['rims-1-4', 'rims-2-3'], ['accent', 'primary']],
			['harness (solo)', ['harness'], ['primary']]
		] as const) {
			const parts = slugs.map((s, k) => mkp(s, rs[k]));
			const t = performance.now();
			const r = arrangeFromSource({ parts, roles, printer }, [
				{ number: 1, name: label, parts: [...slugs] }
			]);
			console.log('PLATE', label, (performance.now() - t).toFixed(0), 'ms plates', r.plates.length);
		}
		expect(1).toBe(1);
	});
});
