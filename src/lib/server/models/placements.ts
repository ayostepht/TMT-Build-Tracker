import { and, eq } from 'drizzle-orm';
import type { PartPlacement } from '#lib/domain/types.ts';
import { ApiError } from '../access.ts';
import type { Db } from '../db/index.ts';
import { templateParts, templatePartPlacements } from '../db/schema.ts';

export const MAX_INSTANCES = 64;
/** Nothing in a chair is further than this (mm); guards against NaN-like junk. */
const MAX_ABS = 1e7;

export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export interface PlacementPatch {
	matrix?: number[];
	instances?: number[][];
	placed?: boolean;
}

function matrix16(v: unknown, what: string): number[] {
	if (!Array.isArray(v) || v.length !== 16)
		throw new ApiError(400, `${what} must be 16 numbers (a column-major 4x4 matrix)`);
	for (const n of v) {
		if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > MAX_ABS)
			throw new ApiError(400, `${what} must contain only finite numbers`);
	}
	return v as number[];
}

/** Validates a PATCH body; unknown keys are rejected. */
export function parsePlacementPatch(body: unknown): PlacementPatch {
	if (typeof body !== 'object' || body === null || Array.isArray(body))
		throw new ApiError(400, 'Expected { matrix?, instances?, placed? }');
	const b = body as Record<string, unknown>;
	for (const k of Object.keys(b))
		if (!['matrix', 'instances', 'placed'].includes(k))
			throw new ApiError(400, `Unknown field ${k}`);
	const out: PlacementPatch = {};
	if (b.matrix !== undefined) out.matrix = matrix16(b.matrix, 'matrix');
	if (b.instances !== undefined) {
		if (!Array.isArray(b.instances)) throw new ApiError(400, 'instances must be an array');
		if (b.instances.length > MAX_INSTANCES)
			throw new ApiError(400, `At most ${MAX_INSTANCES} instances`);
		out.instances = b.instances.map((m, i) => matrix16(m, `instances[${i}]`));
	}
	if (b.placed !== undefined) {
		if (typeof b.placed !== 'boolean') throw new ApiError(400, 'placed must be true or false');
		out.placed = b.placed;
	}
	if (out.matrix === undefined && out.instances === undefined && out.placed === undefined)
		throw new ApiError(400, 'Nothing to change');
	return out;
}

/** Updates (or creates) the placement row of a template part. 404 when the slug is not a part of the template. */
export function applyPlacementPatch(
	db: Db,
	templateId: string,
	slug: string,
	patch: PlacementPatch,
	userId: string | null
): PartPlacement {
	const part = db
		.select({ slug: templateParts.slug })
		.from(templateParts)
		.where(and(eq(templateParts.templateId, templateId), eq(templateParts.slug, slug)))
		.get();
	if (!part) throw new ApiError(404, 'Not found');
	const where = and(
		eq(templatePartPlacements.templateId, templateId),
		eq(templatePartPlacements.slug, slug)
	);
	const existing = db.select().from(templatePartPlacements).where(where).get();
	const next = {
		matrix: patch.matrix ?? existing?.matrix ?? IDENTITY,
		instances: patch.instances ?? existing?.instances ?? [],
		placed: patch.placed ?? existing?.placed ?? false
	};
	if (existing) {
		db.update(templatePartPlacements)
			.set({ ...next, updatedBy: userId, updatedAt: new Date() })
			.where(where)
			.run();
	} else {
		db.insert(templatePartPlacements)
			.values({ templateId, slug, ...next, updatedBy: userId })
			.run();
	}
	return { slug, ...next };
}
