import { and, eq, inArray } from 'drizzle-orm';
import { buildRows, recentBuilds } from '#lib/server/builds/list.ts';
import { loadBuildView } from '#lib/server/builds/view.ts';
import { getDb } from '#lib/server/db/index.ts';
import { buildParts, builds } from '#lib/server/db/schema.ts';
import type { BuildView } from '#lib/domain/types.ts';
import type { PageServerLoad } from './$types';

/**
 * Most builds the landing shows controls for. Each one's start/log control opens a printer stream
 * (the nav opens one more), and a browser allows 6 connections per host over HTTP/1.1, so 3 builds
 * leave room for page loads. The landing polls build state instead of streaming it. "All builds" has the rest.
 */
const LANDING_BUILD_CAP = 3;

export const load: PageServerLoad = async ({ parent, locals }) => {
	const { team } = await parent();
	const db = getDb();
	const rows = buildRows(db, [team.id]);
	if (!locals.user || !rows.length) return { builds: rows, landing: { views: [], more: 0 } };

	// Builds with a part on a printer always come first, then the most recently active unfinished
	// ones. `loadBuildView` applies the same member check as the build page itself.
	const printingIds = new Set(
		db
			.select({ id: buildParts.buildId })
			.from(buildParts)
			.innerJoin(builds, eq(builds.id, buildParts.buildId))
			.where(
				and(
					eq(builds.organizationId, team.id),
					eq(builds.kind, 'build'),
					eq(buildParts.status, 'Printing'),
					inArray(
						builds.id,
						rows.map((r) => r.id)
					)
				)
			)
			.all()
			.map((r) => r.id)
	);
	const candidates = recentBuilds(db, [team.id], rows.length).filter(
		(b) => printingIds.has(b.id) || (b.setupStep === null && b.total > 0 && b.printed < b.total)
	);
	const ordered = [
		...candidates.filter((b) => printingIds.has(b.id)),
		...candidates.filter((b) => !printingIds.has(b.id))
	];
	const views: BuildView[] = [];
	for (const b of ordered.slice(0, LANDING_BUILD_CAP)) {
		const v = loadBuildView(db, b.id, locals.user.id);
		if (v) views.push(v);
	}
	return { builds: rows, landing: { views, more: Math.max(0, ordered.length - views.length) } };
};
