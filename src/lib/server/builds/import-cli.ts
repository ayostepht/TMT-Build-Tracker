/**
 * Entry point for `scripts/import-prototype.mjs`. Bundled on its own by
 * `vite.cli.config.ts` into `build/cli/import-cli.js` (no SvelteKit runtime),
 * so the CLI uses exactly the same converter and server function as the app.
 */
import { asc, eq, or } from 'drizzle-orm';
import { ApiError } from '../access';
import { openDb, type Db } from '../db';
import { builds, colorDesigns, member, organization } from '../db/schema';
import { createBuild } from './create';
import { importPrototype, previewPrototype, type ImportPreview, type ImportResult } from './import';

export { openDb };

export function listWorkspaces(db: Db) {
	return db
		.select({ id: organization.id, name: organization.name, slug: organization.slug })
		.from(organization)
		.orderBy(asc(organization.name))
		.all()
		.map((o) => ({
			...o,
			builds: db
				.select({ id: builds.id, name: builds.name })
				.from(builds)
				.where(eq(builds.organizationId, o.id))
				.orderBy(asc(builds.name))
				.all()
		}));
}

export interface CliTarget {
	buildId?: string;
	newBuild?: { name: string; workspace: string; design: string };
}

class Rollback extends Error {}

/** Create the new build if asked, then preview or import. Dry runs write nothing. */
export function runImport(
	db: Db,
	target: CliTarget,
	data: unknown,
	opts: { replace: boolean; dryRun: boolean }
): { buildId: string | null; result: ImportPreview | ImportResult } {
	let out: { buildId: string | null; result: ImportPreview | ImportResult } | undefined;
	try {
		db.transaction((txRaw) => {
			const tx = txRaw as unknown as Db;
			let buildId = target.buildId;
			if (!buildId) {
				const nb = target.newBuild;
				if (!nb) throw new ApiError(400, 'Give --build, or --new with --workspace and --design');
				const org = tx
					.select()
					.from(organization)
					.where(or(eq(organization.id, nb.workspace), eq(organization.slug, nb.workspace)))
					.get();
				if (!org) throw new ApiError(404, `No workspace "${nb.workspace}" (see --list)`);
				const design = tx.select().from(colorDesigns).where(eq(colorDesigns.slug, nb.design)).get();
				if (!design) throw new ApiError(404, `No design "${nb.design}"`);
				const members = tx.select().from(member).where(eq(member.organizationId, org.id)).all();
				const owner = members.find((m) => m.role.split(',')[0].trim() === 'owner') ?? members[0];
				if (!owner) throw new ApiError(400, 'That workspace has no members');
				buildId = createBuild(
					tx,
					{
						organizationId: org.id,
						templateId: design.templateId,
						designId: design.id,
						name: nb.name
					},
					owner.userId
				);
			}
			const result = opts.dryRun
				? previewPrototype(tx, buildId, null, data)
				: importPrototype(tx, buildId, null, data, { replace: opts.replace });
			out = { buildId: target.buildId ? buildId : opts.dryRun ? null : buildId, result };
			if (opts.dryRun) throw new Rollback();
		});
	} catch (e) {
		if (!(e instanceof Rollback)) throw e;
	}
	return out!;
}
