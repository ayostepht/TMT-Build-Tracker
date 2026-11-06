/**
 * The build's "print template": per-part print time and grams learned from a sliced file, kept in
 * `build_part_profiles` independently of the build's plate layout (see `domain/part-profile.ts`).
 */
import { eq } from 'drizzle-orm';
import {
	learnPartProfiles,
	meshVolume,
	resolveProfile,
	type LearnObject,
	type LearnPlate,
	type LearnedProfile
} from '#lib/domain/part-profile.ts';
import { objectKey } from '#lib/domain/plates-match.ts';
import type { StoredSummary } from '#lib/domain/threemf.ts';
import type { PartDef, PartProfileInfo, PrintTemplateInfo } from '#lib/domain/types.ts';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import type { Db } from '../db';
import { buildPartProfiles, templatePrintGeometry } from '../db/schema';
import { readPieceMesh } from '../print-geometry/store';

type Row = typeof buildPartProfiles.$inferSelect;

export const loadProfileRows = (db: Db, buildId: string): Row[] =>
	db.select().from(buildPartProfiles).where(eq(buildPartProfiles.buildId, buildId)).all();

/** The stored profiles as they apply to the parts' current roles, plus the template summary. */
export function resolveProfiles(
	rows: Row[],
	allParts: PartDef[],
	roleKeys: string[]
): { profiles: Record<string, PartProfileInfo>; template: PrintTemplateInfo | null } {
	const partBy = new Map(allParts.map((p) => [p.slug, p]));
	const profiles: Record<string, PartProfileInfo> = {};
	for (const r of rows) {
		const part = partBy.get(r.partSlug);
		if (!part) continue;
		const res = resolveProfile(
			{
				secondsPerCopy: r.secondsPerCopy,
				gramsByRole: r.gramsByRole,
				method: r.method,
				context: r.context as { partRole?: string }
			},
			part.role,
			roleKeys
		);
		profiles[r.partSlug] = {
			secondsPerCopy: res.secondsPerCopy,
			gramsByRole: res.gramsByRole,
			method: res.method,
			remapped: res.remapped,
			learnedRole: res.learnedRole,
			copies:
				typeof (r.context as { copies?: unknown }).copies === 'number'
					? (r.context as { copies: number }).copies
					: null,
			source: r.source
		};
	}
	const used = rows.filter((r) => profiles[r.partSlug]);
	if (!used.length) return { profiles, template: null };
	const ctx = (used[0].context ?? {}) as Record<string, unknown>;
	const methods = new Set(used.map((r) => r.method));
	const when = Math.max(...used.map((r) => r.updatedAt?.getTime() ?? 0));
	return {
		profiles,
		template: {
			source: used[0].source,
			fileName: typeof ctx.fileName === 'string' ? ctx.fileName : null,
			plates: typeof ctx.plates === 'number' ? ctx.plates : null,
			printer: typeof ctx.printer === 'string' ? ctx.printer : null,
			learnedAt: new Date(when || Date.now()).toISOString(),
			method: methods.size > 1 ? 'mixed' : methods.has('exact') ? 'exact' : 'volume-split',
			parts: used.length,
			remapped: Object.values(profiles).filter((p) => p.remapped).length
		}
	};
}

// ---- mesh volumes

interface PieceVolume {
	name: string;
	copies: number;
	volume: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Volumes of the pieces of each part, from the stored print meshes (null where a piece has no mesh). */
export function pieceVolumes(
	db: Db,
	templateId: string,
	slugs: Set<string>
): Map<string, PieceVolume[]> {
	const out = new Map<string, PieceVolume[]>();
	for (const r of db
		.select()
		.from(templatePrintGeometry)
		.where(eq(templatePrintGeometry.templateId, templateId))
		.all()) {
		if (!slugs.has(r.slug)) continue;
		const fp = r.footprint as unknown as PrintFootprint;
		out.set(
			r.slug,
			(fp?.pieces ?? []).map((pc) => {
				let volume: number | null = null;
				if (pc.mesh) {
					try {
						const m = readPieceMesh(templateId, pc.mesh);
						volume = meshVolume(m.positions, m.indices) || null;
					} catch {
						volume = null;
					}
				}
				return { name: pc.name, copies: Math.max(1, pc.copies || 1), volume };
			})
		);
	}
	return out;
}

/** Volume of the piece an object most likely is: by name, else the part's average piece. */
function objectVolume(pieces: PieceVolume[] | undefined, objectName: string): number | null {
	if (!pieces?.length) return null;
	const n = norm(objectName);
	const hit =
		pieces.find((p) => norm(p.name) === n) ??
		pieces.find(
			(p) => norm(p.name).length > 3 && (n.includes(norm(p.name)) || norm(p.name).includes(n))
		);
	if (hit) return hit.volume;
	const vs = pieces.map((p) => p.volume).filter((v): v is number => v !== null);
	return vs.length === pieces.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
}

// ---- learning

export interface LearnInput {
	templateId: string;
	summary: StoredSummary;
	mapping: Record<string, string | null>;
	filamentMap: Record<string, string>;
	allParts: PartDef[];
	fileName: string;
	uploadId: string;
}

/** Pure part of learning from a stored upload summary: the per-part profiles (nothing written). */
export function learnFromSummary(db: Db, inp: LearnInput): LearnedProfile[] {
	const slugs = new Set(Object.values(inp.mapping).filter((s): s is string => !!s));
	const vols = pieceVolumes(db, inp.templateId, slugs);
	const plates: LearnPlate[] = inp.summary.plates
		.filter((pl) => (pl.estSeconds ?? 0) > 0 || Object.keys(pl.filamentGrams).length)
		.map((pl) => ({
			index: pl.index,
			seconds: pl.estSeconds,
			runs: Math.max(1, pl.runsHint || 1),
			filamentGrams: pl.filamentGrams,
			exact: pl.exact,
			objects: pl.objects.map((o): LearnObject => {
				const slug = inp.mapping[objectKey(pl.index, o.id)] ?? null;
				return {
					name: o.name,
					slug,
					count: o.count,
					volume: slug ? objectVolume(vols.get(slug), o.name) : null
				};
			})
		}));
	const learned = learnPartProfiles({
		plates,
		parts: inp.allParts.map((p) => {
			const pieces = vols.get(p.slug);
			return {
				slug: p.slug,
				role: p.role,
				qty: p.qty,
				piecesPerUnit: pieces?.length ? pieces.reduce((a, c) => a + c.copies, 0) : null
			};
		}),
		filamentMap: inp.filamentMap
	});
	// A part cut from the same source file as a learned one is the same geometry in another color or
	// position (the two rim pairs, a twin variant): the file taught the same time per copy.
	const bySlug = new Map(inp.allParts.map((p) => [p.slug, p]));
	const have = new Set(learned.map((l) => l.slug));
	for (const u of inp.allParts) {
		if (have.has(u.slug) || !u.sourceFile) continue;
		const twin = learned.find((l) => bySlug.get(l.slug)?.sourceFile === u.sourceFile);
		if (!twin) continue;
		const from = twin.partRole;
		learned.push({
			...twin,
			slug: u.slug,
			partRole: u.role,
			gramsByRole: Object.fromEntries(
				Object.entries(twin.gramsByRole).map(([r, g]) => [r === from ? u.role : r, g])
			)
		});
	}
	return learned;
}

/** Replace the build's learned data with `profiles` (inside a transaction). Returns how many parts were stored. */
export function storeProfiles(
	tx: Db,
	buildId: string,
	profiles: LearnedProfile[],
	meta: { source: string; fileName: string; plates: number; printer: string | null }
): number {
	tx.delete(buildPartProfiles).where(eq(buildPartProfiles.buildId, buildId)).run();
	const now = new Date();
	for (const p of profiles)
		tx.insert(buildPartProfiles)
			.values({
				buildId,
				partSlug: p.slug,
				secondsPerCopy: p.secondsPerCopy,
				gramsByRole: p.gramsByRole,
				source: meta.source,
				method: p.method,
				context: {
					partRole: p.partRole,
					copies: p.copies,
					fileName: meta.fileName,
					plates: meta.plates,
					printer: meta.printer
				},
				updatedAt: now
			})
			.run();
	return profiles.length;
}

export function clearProfiles(tx: Db, buildId: string): number {
	return tx.delete(buildPartProfiles).where(eq(buildPartProfiles.buildId, buildId)).run().changes;
}
