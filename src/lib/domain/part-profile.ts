/**
 * Per-part print data learned from a sliced file (the build's "print template").
 *
 * A sliced 3MF knows how long each plate takes and how many grams of each filament it uses, but the
 * app thinks in parts, and a recolor moves parts between plates. So the plate totals are taken apart:
 *
 * - `exact`: the plate's G-code was measured per object (`gcode-objects.ts`): each object's share of the
 *   plate's time and of each filament's grams follows what it actually cost, including its share of the
 *   prime tower and purging.
 * - `volume-split`: no per-object data; the plate's time and each filament's grams are shared among the
 *   plate's objects by mesh volume (per instance, from the kit's print geometry). A filament goes to the
 *   objects whose part is in that filament's role, or to all of them when none is.
 *
 * Then every part gets seconds per copy and grams per copy by filament role. When the build's colors
 * change afterwards, `resolveProfile` moves a part's grams to its new role; the time stays.
 * Pure: no DB, no Node.
 */
import type { ExactObject } from './threemf.ts';

export type ProfileMethod = 'exact' | 'volume-split';

export interface LearnObject {
	/** Object name as in the 3MF (copy tail stripped). */
	name: string;
	/** Part the user mapped it to; null = not a part of this build (ignored). */
	slug: string | null;
	/** Instances on the plate. */
	count: number;
	/** Mesh volume of ONE instance in mm3, when known. */
	volume?: number | null;
}

export interface LearnPlate {
	index: number;
	/** Slicer time of one run, seconds. */
	seconds: number | null;
	/** How many times the plate is printed (the name's "PRINT X4"). */
	runs: number;
	/** Grams per run by 1-based filament index (string key). */
	filamentGrams: Record<string, number>;
	objects: LearnObject[];
	exact?: ExactObject[];
}

export interface LearnPart {
	slug: string;
	/** The part's role in the build now. */
	role: string;
	qty: number | null;
	/** Pieces (objects) of ONE unit of the part, from the print geometry; null = unknown. */
	piecesPerUnit?: number | null;
}

export interface LearnedProfile {
	slug: string;
	/** Seconds to print one copy (unit) of the part. */
	secondsPerCopy: number | null;
	/** Grams of one copy by role key. */
	gramsByRole: Record<string, number>;
	method: ProfileMethod;
	/** Copies of the part the file prints (all plates, all runs). */
	copies: number;
	/** The part's role when it was learned: grams of this role follow the part when it is recolored. */
	partRole: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Weights of the plate's objects: exact seconds when measured, else mesh volume (equal per instance when unknown). */
interface Weighted {
	o: LearnObject;
	/** Weight for time. */
	wTime: number;
	/** Measured mm per filament index, exact only. */
	mm?: Record<string, number>;
	exact: boolean;
}

function weigh(pl: LearnPlate): { items: Weighted[]; exact: boolean } {
	const byName = new Map<string, ExactObject>();
	for (const e of pl.exact ?? []) byName.set(norm(e.name), e);
	const live = pl.objects.filter((o) => o.count > 0);
	const found = live.map((o) => byName.get(norm(o.name)));
	const allExact = live.length > 0 && found.every((f) => !!f && f.seconds > 0);
	if (allExact)
		return {
			exact: true,
			items: live.map((o, i) => ({ o, wTime: found[i]!.seconds, mm: found[i]!.mm, exact: true }))
		};
	const vols = live.map((o) => (o.volume && o.volume > 0 ? o.volume : null));
	const known = vols.filter((v): v is number => v !== null);
	const fill = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
	return {
		exact: false,
		items: live.map((o, i) => ({ o, wTime: (vols[i] ?? fill) * o.count, exact: false }))
	};
}

export function learnPartProfiles(input: {
	plates: LearnPlate[];
	parts: LearnPart[];
	/** 1-based 3MF filament index (string) → role key. */
	filamentMap: Record<string, string | null | undefined>;
}): LearnedProfile[] {
	const partOf = new Map(input.parts.map((p) => [p.slug, p]));
	interface Acc {
		sec: number;
		grams: Record<string, number>;
		instances: number;
		exactPlates: number;
		volumePlates: number;
	}
	const acc = new Map<string, Acc>();
	const get = (slug: string) => {
		let a = acc.get(slug);
		if (!a)
			acc.set(slug, (a = { sec: 0, grams: {}, instances: 0, exactPlates: 0, volumePlates: 0 }));
		return a;
	};

	for (const pl of input.plates) {
		const { items, exact } = weigh(pl);
		const mapped = items.filter((w) => w.o.slug && partOf.has(w.o.slug));
		if (!mapped.length) continue;
		const runs = Math.max(1, pl.runs || 1);
		// Unmapped objects that were measured still take their share of the plate.
		const denomSet = exact ? items : mapped;
		const denom = denomSet.reduce((a, w) => a + w.wTime, 0);
		if (denom <= 0) continue;

		for (const w of mapped) {
			const a = get(w.o.slug!);
			if (pl.seconds && pl.seconds > 0) a.sec += ((pl.seconds * w.wTime) / denom) * runs;
			a.instances += w.o.count * runs;
			if (exact) a.exactPlates++;
			else a.volumePlates++;
		}

		// A plate's grams go only to roles its parts have: a stray slot (say TPU on a PETG plate) must not
		// become grams of a part that never uses it. When NO slot matches a part role (the build was
		// recolored since slicing), nothing is stray and the plate's filament counts under the parts' own color.
		const partRoles = new Set(mapped.map((w) => partOf.get(w.o.slug!)!.role));
		const anySlotMatches = Object.entries(pl.filamentGrams).some(
			([i, g]) => g > 0 && partRoles.has(input.filamentMap[i] ?? '')
		);

		for (const [idx, g] of Object.entries(pl.filamentGrams)) {
			const role = input.filamentMap[idx];
			if (!role || !(g > 0)) continue;
			// Who gets this filament's grams
			let weights: { slug: string; w: number }[];
			const mm = (w: Weighted) => w.mm?.[idx] ?? 0;
			const mmTotal = exact ? items.reduce((a, w) => a + mm(w), 0) : 0;
			if (exact && mmTotal > 0) {
				weights = mapped.filter((w) => mm(w) > 0).map((w) => ({ slug: w.o.slug!, w: mm(w) }));
				// share of the measured total (unmapped objects keep theirs; the tower and purge go proportionally)
				for (const x of weights)
					get(x.slug).grams[role] = (get(x.slug).grams[role] ?? 0) + ((g * x.w) / mmTotal) * runs;
				continue;
			}
			const inRole = mapped.filter((w) => partOf.get(w.o.slug!)!.role === role);
			if (!inRole.length && anySlotMatches) continue; // stray slot
			const pool = inRole.length ? inRole : mapped;
			const sum = pool.reduce((a, w) => a + w.wTime, 0);
			if (sum <= 0) continue;
			for (const w of pool) {
				const a = get(w.o.slug!);
				a.grams[role] = (a.grams[role] ?? 0) + ((g * w.wTime) / sum) * runs;
			}
		}
	}

	const out: LearnedProfile[] = [];
	for (const [slug, a] of acc) {
		const part = partOf.get(slug)!;
		const per = part.piecesPerUnit && part.piecesPerUnit > 0 ? part.piecesPerUnit : null;
		const qty = Math.max(1, part.qty ?? 1);
		// The file is the truth about how many copies were sliced; fall back to the kit's quantity.
		let copies = qty;
		if (per) {
			const u = a.instances / per;
			if (u >= 0.99 && Math.abs(u - Math.round(u)) < 0.02) copies = Math.round(u);
		}
		out.push({
			slug,
			secondsPerCopy: a.sec > 0 ? Math.round(a.sec / copies) : null,
			gramsByRole: Object.fromEntries(
				Object.entries(a.grams)
					.map(([r, g]) => [r, round(g / copies, 2)] as const)
					.filter(([, g]) => g > 0)
			),
			method: a.exactPlates > 0 && a.volumePlates === 0 ? 'exact' : 'volume-split',
			copies,
			partRole: part.role
		});
	}
	return out;
}

export interface StoredProfile {
	secondsPerCopy: number | null;
	gramsByRole: Record<string, number>;
	method: string;
	context: { partRole?: string } & Record<string, unknown>;
}

export interface ResolvedProfile {
	secondsPerCopy: number | null;
	/** Grams per copy by the part's CURRENT roles. */
	gramsByRole: Record<string, number>;
	/** The part's grams were moved to a new role (the build was recolored since learning). */
	remapped: boolean;
	method: ProfileMethod;
	/** Role the grams were learned for. */
	learnedRole: string | null;
}

/**
 * The profile as it applies to the build today. The part's main filament (the one with most grams) always
 * follows the part to its current role, so a recolor moves the part's grams to its new color, and a file
 * sliced with another filament than the design uses still counts under the part's own color. Grams of
 * minor filaments (support, tower) keep their role unless that role no longer exists. Time never changes.
 * `remapped` tells that the part's color differs from what it was when learned (or a role vanished).
 */
export function resolveProfile(
	p: StoredProfile,
	currentRole: string,
	roleKeys: string[]
): ResolvedProfile {
	const learnedRole = typeof p.context.partRole === 'string' ? p.context.partRole : null;
	const entries = Object.entries(p.gramsByRole);
	const main = entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
	const grams: Record<string, number> = {};
	let folded = false;
	for (const [role, g] of entries) {
		let to = role;
		if (role === main) to = currentRole;
		else if (!roleKeys.includes(role)) {
			to = currentRole;
			folded = true;
		}
		grams[to] = round((grams[to] ?? 0) + g, 2);
	}
	return {
		secondsPerCopy: p.secondsPerCopy,
		gramsByRole: grams,
		remapped: folded || (learnedRole !== null && learnedRole !== currentRole),
		method: p.method === 'exact' ? 'exact' : 'volume-split',
		learnedRole
	};
}

/** Volume of a closed triangle mesh in mm3 (absolute value of the signed volume). */
export function meshVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
	let v = 0;
	for (let i = 0; i + 2 < indices.length; i += 3) {
		const a = indices[i] * 3;
		const b = indices[i + 1] * 3;
		const c = indices[i + 2] * 3;
		const ax = positions[a];
		const ay = positions[a + 1];
		const az = positions[a + 2];
		const bx = positions[b];
		const by = positions[b + 1];
		const bz = positions[b + 2];
		const cx = positions[c];
		const cy = positions[c + 1];
		const cz = positions[c + 2];
		v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
	}
	return Math.abs(v / 6);
}
