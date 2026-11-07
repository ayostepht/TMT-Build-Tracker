/**
 * "Twins": kit parts cut from the same source object (the two wheel rim pairs share
 * `3DTMT O WHEEL RIM REV B.STEP`; one is printed in Accent, the other in Primary). A slicer
 * project holds ONE object for them and prints it several times, so when an uploaded plate
 * matches one twin the plate belongs to all of them: every active twin goes on the plate,
 * each printed its share of the plate's runs (`perPartRuns`), with the plate's grams per run.
 *
 * Pure: no DB, no Node.
 */
import { objectKey } from './plates-match.ts';

export interface TwinPart {
	slug: string;
	sourceFile: string;
	components?: { name: string; file?: string }[];
}

const FILE = /\.(step|stp|stl|3mf|obj|iges|igs|f3d)\s*$/i;
const squash = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Identity of the source object, or null when the part has none worth comparing (placeholders such as "MakerWorld 3mf only"). */
export function twinKey(p: TwinPart): string | null {
	if (FILE.test(p.sourceFile.trim())) return `f:${squash(p.sourceFile)}`;
	const files = (p.components ?? [])
		.map((c) => c.file?.trim())
		.filter((f): f is string => !!f && FILE.test(f))
		.map(squash);
	return files.length ? `c:${[...new Set(files)].sort().join('|')}` : null;
}

/** Groups of 2+ parts that share a source object, in part order. Pass every template part (inactive variants included). */
export function twinGroups(parts: TwinPart[]): string[][] {
	const by = new Map<string, string[]>();
	for (const p of parts) {
		const k = twinKey(p);
		if (k) by.set(k, [...(by.get(k) ?? []), p.slug]);
	}
	return [...by.values()].filter((g) => g.length > 1);
}

/** The slugs of the group `slug` belongs to (itself included), or just `[slug]`. */
export function twinsOf(slug: string, groups: string[][]): string[] {
	return groups.find((g) => g.includes(slug)) ?? [slug];
}

/** Runs each twin prints when `total` runs are shared among `n` twins: the share rounded up. */
export function splitTwinRuns(total: number, n: number): { perPart: number; even: boolean } {
	const t = Math.max(1, Math.round(total) || 1);
	const k = Math.max(1, n);
	return { perPart: Math.ceil(t / k), even: t % k === 0 };
}

export interface TwinExpansion {
	/** Object key the expansion came from. */
	key: string;
	/** The part the object was mapped to. */
	from: string;
	/** Every active twin of `from`, `from` included, in group order. */
	twins: string[];
}

export interface PlatePartsPlan {
	/** Parts on the plate (mapped parts, plus the twins they stand for). */
	parts: string[];
	/** A twin plate: every part prints `runsPerPart` times. */
	perPartRuns: boolean;
	/** Runs stored on the plate: per part for a twin plate, else the plate's runs. */
	runs: number;
	/** Runs the file prints in total (a twin plate shares them among its parts). */
	totalRuns: number;
	expansions: TwinExpansion[];
	/** Shown in the review and returned from apply. */
	warning: string | null;
}

/**
 * Parts and runs of one uploaded plate. An object mapped to a twin stands for all active twins
 * unless `single[objectKey]` keeps it to that one part. Only a plate made of one twin group is
 * shared out (mixed plates stay as mapped, with a warning): other parts on it would inherit the
 * per-part runs.
 */
export function planPlateParts(input: {
	plateIndex: number;
	objects: { id: string }[];
	mapping: Record<string, string | null | undefined>;
	/** Object keys to keep as the single mapped part. */
	single?: Record<string, boolean | undefined>;
	groups: string[][];
	isActive: (slug: string) => boolean;
	runsHint: number;
}): PlatePartsPlan {
	const total = Math.max(1, input.runsHint || 1);
	const mapped: string[] = [];
	const expansions: TwinExpansion[] = [];
	for (const o of input.objects) {
		const key = objectKey(input.plateIndex, o.id);
		const s = input.mapping[key];
		if (!s) continue;
		if (!mapped.includes(s)) mapped.push(s);
		if (input.single?.[key]) continue;
		const twins = twinsOf(s, input.groups).filter((t) => t === s || input.isActive(t));
		if (twins.length > 1) expansions.push({ key, from: s, twins });
	}
	const plain: PlatePartsPlan = {
		parts: mapped,
		perPartRuns: false,
		runs: total,
		totalRuns: total,
		expansions: [],
		warning: null
	};
	// Twins the mapping already names (an object per twin) need no expansion.
	const needed = expansions.filter((e) => e.twins.some((t) => !mapped.includes(t)));
	if (!needed.length) return plain;
	const group = needed[0].twins;
	const sameGroup = needed.every((e) => e.twins.join() === group.join());
	const onlyGroup = mapped.every((s) => group.includes(s));
	if (!sameGroup || !onlyGroup)
		return {
			...plain,
			warning:
				'This plate mixes parts that share a source object with other parts, so it was not shared out between them. Check the parts on it.'
		};
	const { perPart, even } = splitTwinRuns(total, group.length);
	return {
		parts: group,
		perPartRuns: true,
		runs: perPart,
		totalRuns: total,
		expansions: needed,
		warning: even
			? null
			: `${total} run${total === 1 ? '' : 's'} do not divide evenly between ${group.length} parts; each part is set to ${perPart}.`
	};
}
