/**
 * Server side of the plate arranger: turns a `BuildView` plus the template's print
 * footprints into `arrange()` input, and writes the result as the build's plates
 * (`source = 'arranged'`, positions in `build_plates.arrangement`).
 *
 * Kept free of `mutateBuild` so it can be called from inside it (automatic
 * re-arrange after a color / variant / printer change).
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
	arrange,
	type ArrangeOptions,
	type ArrangeInput,
	type ArrangePart,
	type ArrangeResult,
	type ArrangeRole,
	type ArrangedPlate
} from '#lib/domain/arrange.ts';
import {
	arrangeFromSource,
	RULES_V2,
	RULES_V3,
	soloParts,
	type SourceArrangeResult,
	type SourceMove,
	type SourcePlate
} from '#lib/domain/arrange-source.ts';
import { pieceBrimMm, type PrintFootprint } from '#lib/domain/print-footprint.ts';
import type { LearnedTime } from '#lib/domain/time-estimate.ts';
import type { BuildView } from '#lib/domain/types.ts';
import { layoutBed } from '#lib/printers/layout-bed.ts';
import { effectiveKeepOut } from '#lib/printers/printer.ts';
import { asc } from 'drizzle-orm';
import type { Db } from '../db';
import {
	buildPlates,
	builds,
	templatePlateLayouts,
	templatePlates,
	templatePrintGeometry
} from '../db/schema';
import { gramsSourceOf, loadBuildView } from './view';
import { estimateArrangedPlates, loadTimeModel } from './time-model';
import { ensureSilhouettes } from '../print-geometry/store';

export const ARRANGED_LAYOUT = 'arranged';
export const ARRANGED_SOURCE = 'arranged';

/**
 * Version of the planner that wrote an arrangement. 2 = the kit's layout comes first (`arrangeFromSource`);
 * 3 = plates printed in runs of their own stay one plate (the wheel rims) and a part that moved may join
 * an existing multi-part plate (`RULES_V3`). Arrangements stored without a version were planned by the
 * plain arranger and version 2 ones by the planner of rules `RULES_V2`: they are left alone, and their
 * "stale" check still compares against the planner that made them (`planArrangement(..., 'legacy')`,
 * `planArrangement(..., kit, 2)`), so a planner change never flags or rewrites an existing build.
 */
export const PLANNER_VERSION = 3;

/** Source-planner rules of a stored planner version (the current ones for anything newer). */
export const rulesFor = (version: number) => (version <= 2 ? RULES_V2 : RULES_V3);

/** Edge margin stored by builds planned before the default became 1 mm; read as the new default. */
export const OLD_DEFAULT_MARGIN = 5;
export const NEW_DEFAULT_MARGIN = 1;
export const effectiveMargin = (m: number) => (m === OLD_DEFAULT_MARGIN ? NEW_DEFAULT_MARGIN : m);

const TEMPLATE_ROLE_NAMES = /^[a-z]+$/;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Print footprints stored for a template, by slug (seed rows and imported rows alike). */
export function loadFootprints(db: Db, templateId: string): Map<string, PrintFootprint> {
	ensureSilhouettes(db, templateId);
	const out = new Map<string, PrintFootprint>();
	for (const r of db
		.select()
		.from(templatePrintGeometry)
		.where(eq(templatePrintGeometry.templateId, templateId))
		.all()) {
		const fp = r.footprint as unknown as PrintFootprint;
		if (fp?.pieces?.length) out.set(r.slug, { ...fp, slug: r.slug });
	}
	return out;
}

export interface Plan {
	result: ArrangeResult;
	/** Slugs without a footprint. */
	unsized: string[];
	/** The build's print template, as time model input (per-part seconds and grams from the user's slice). */
	learned?: Map<string, LearnedTime>;
}

/** Learned per-part data of a build view as time model input. */
export function learnedOf(view: BuildView): Map<string, LearnedTime> {
	return new Map(
		Object.entries(view.partProfiles ?? {}).map(([slug, pr]) => [
			slug,
			{ secondsPerCopy: pr.secondsPerCopy, gramsByRole: pr.gramsByRole, copies: pr.copies }
		])
	);
}

/** Role labels for plate names: the kit's own slots by key ("Accent"), added colors by name. */
function roleLabel(f: BuildView['filaments'][number]): string {
	return TEMPLATE_ROLE_NAMES.test(f.key) && f.key.length <= 12 ? cap(f.key) : f.name;
}

/** `arrange()` input for a build view: its parts, filament roles and printer. Null without a printer. */
function arrangeInputFor(
	view: BuildView,
	footprints: Map<string, PrintFootprint>,
	layoutHint: string | null,
	options?: ArrangeOptions
): ArrangeInput | null {
	const p = view.printer;
	if (!p) return null;
	const roles: ArrangeRole[] = view.filaments.map((f) => ({
		key: f.key,
		name: roleLabel(f),
		material: f.material,
		tpu: f.tpu
	}));
	const parts: ArrangePart[] = [];
	const unsized: { slug: string; name: string; role: string; grams: number | null }[] = [];
	for (const part of view.parts) {
		const units = Math.max(1, part.qty ?? 1);
		const learnedGrams = Object.values(view.partProfiles?.[part.slug]?.gramsByRole ?? {}).reduce(
			(a, b) => a + b,
			0
		);
		const grams =
			learnedGrams > 0
				? Math.round(learnedGrams * 10) / 10
				: part.bomGrams != null
					? Math.round((part.bomGrams / units) * 10) / 10
					: null;
		const fp = footprints.get(part.slug);
		if (!fp) {
			unsized.push({ slug: part.slug, name: part.name, role: part.role, grams: part.bomGrams });
			continue;
		}
		const brims = fp.pieces.map((pc) => pieceBrimMm(pc, part.brim));
		const bits: string[] = [];
		if (part.variantGroup) {
			const g = view.variantGroups.find((x) => x.key === part.variantGroup);
			const others = g?.options.filter((o) => o.key !== part.variantOption) ?? [];
			if (g && others.length)
				bits.push(
					`Try the ${others.map((o) => `"${o.name}"`).join(' or ')} option for ${g.name} (Settings, Options).`
				);
		}
		if (layoutHint) bits.push(layoutHint);
		parts.push({
			slug: part.slug,
			name: part.name,
			role: part.role,
			footprint: fp,
			units,
			grams,
			group: part.symmetryGroup ? `sym:${part.symmetryGroup}` : null,
			hint: bits.join(' ') || null,
			baseRole: part.defaultRole,
			...(brims.some((b) => b > 0) ? { brims } : {})
		});
	}
	return {
		parts,
		unsized,
		roles,
		printer: {
			bedX: p.bedX,
			bedY: p.bedY,
			bedZ: p.bedZ,
			margin: effectiveMargin(p.margin),
			spacing: p.spacing,
			keepOut: effectiveKeepOut(p),
			mmSlots: p.mmSlots
		},
		// TMT_ARRANGE_OPTIMIZE=off: diagnostic switch to compare with the packer-only layout (screenshots, bug reports)
		options:
			options ?? (process.env.TMT_ARRANGE_OPTIMIZE === 'off' ? { optimize: false } : undefined)
	};
}

/**
 * The kit's own plate layout for a build, as the arranger's source (see `domain/arrange-source.ts`):
 * `plates` null = no layout fits the build's bed (the arranger runs on its own, still keeping the
 * parts that are alone on a plate in the kit alone: `solo`).
 */
export interface KitSource {
	plates: SourcePlate[] | null;
	/** Parts that are alone on their plate in the nearest kit layout (used when `plates` is null). */
	solo: string[];
	/** Layout key ('xpa', 'h2d', ..., 'upload', 'template') or null. */
	layout: string | null;
	/** Name for notes: "Bambu X1 / P1 / A1" or "your uploaded file". */
	name: string;
}

const SAME_BED = 0.5;

/**
 * Pick the source layout for a build: the user's uploaded file when the plates are that; else the layout
 * the build was set to (a MakeGood profile), else the kit's layout whose bed is the largest one the
 * build's printer still holds (the default layout for a 256 bed, the H series one for a big bed). A
 * layout made for a bigger bed than the printer's is no source (rule E). Null without a printer.
 */
export function loadKitSource(db: Db, view: BuildView): KitSource | null {
	const p = view.printer;
	if (!p) return null;
	const active = new Set(view.parts.map((x) => x.slug));
	const asSource = (
		plates: { number: number; name: string; runs: number; perPartRuns?: boolean; parts: string[] }[]
	): SourcePlate[] =>
		plates
			.map((x) => ({
				number: x.number,
				name: x.name,
				runs: x.runs,
				...(x.perPartRuns ? { perPartRuns: true } : {}),
				parts: x.parts.filter((s) => active.has(s))
			}))
			.filter((x) => x.parts.length)
			.sort((a, b) => a.number - b.number);
	if (view.plates.length && view.plates.every((x) => x.source.startsWith('upload:')))
		return {
			plates: asSource(view.plates),
			solo: [],
			layout: 'upload',
			name: 'your uploaded file'
		};
	const b = db
		.select({ layout: builds.plateLayout })
		.from(builds)
		.where(eq(builds.id, view.build.id))
		.get();
	const rows = db
		.select()
		.from(templatePlateLayouts)
		.where(eq(templatePlateLayouts.templateId, view.build.templateId))
		.orderBy(asc(templatePlateLayouts.sort))
		.all();
	const layouts = rows.map((l) => ({
		key: l.key,
		name: l.name,
		isDefault: l.isDefault,
		bed: layoutBed(l.key),
		plates: l.plates
	}));
	if (!layouts.length) {
		const tpl = db
			.select()
			.from(templatePlates)
			.where(eq(templatePlates.templateId, view.build.templateId))
			.orderBy(asc(templatePlates.number))
			.all();
		return {
			plates: tpl.length ? asSource(tpl) : null,
			solo: [],
			layout: tpl.length ? 'template' : null,
			name: 'the kit layout'
		};
	}
	const fits = (l: (typeof layouts)[number]) =>
		!l.bed || (l.bed.bedX <= p.bedX + SAME_BED && l.bed.bedY <= p.bedY + SAME_BED);
	const bedArea = (l: (typeof layouts)[number]) => (l.bed ? l.bed.bedX * l.bed.bedY : 0);
	const candidates = layouts.filter(fits);
	const chosen =
		candidates.find((l) => l.key === b?.layout) ??
		[...candidates].sort(
			(a, c) => bedArea(c) - bedArea(a) || Number(c.isDefault) - Number(a.isDefault)
		)[0];
	if (chosen)
		return { plates: asSource(chosen.plates), solo: [], layout: chosen.key, name: chosen.name };
	// no layout for this bed: the nearest one still says which parts stand alone
	const target = p.bedX * p.bedY;
	const near = [...layouts].sort(
		(a, c) =>
			Math.abs(bedArea(a) - target) - Math.abs(bedArea(c) - target) ||
			Number(c.isDefault) - Number(a.isDefault)
	)[0];
	return { plates: null, solo: soloParts(asSource(near.plates)), layout: null, name: near.name };
}

export interface Plan {
	result: ArrangeResult;
	/** Slugs without a footprint. */
	unsized: string[];
	/** The build's print template, as time model input (per-part seconds and grams from the user's slice). */
	learned?: Map<string, LearnedTime>;
	/** Set when the plan follows a source layout (the kit's or the maker's file). */
	source?: { layout: string | null; name: string; kept: number[]; moves: SourceMove[] };
}

/**
 * Fresh plans of the last requests, so reading the same build twice (the arrangement banner, the export,
 * the Files tab refresh) plans once. Holds the plan result only, nothing about the build or the user, and
 * is keyed by a digest of EVERYTHING the plan depends on (`planKey`), never by build id: a change of
 * colour, variant, quantity, printer, bed options, footprint or kit layout is a different key, so a plan
 * can only be returned for the exact input it was made from. Bounded (least recently used goes first);
 * entries are cloned in and out, so a caller that edits a plan cannot change what the next one gets.
 */
const PLAN_CACHE_MAX = 50;
const planCache = new Map<string, Plan>();
export const planCacheStats = { hits: 0, misses: 0 };
export const clearPlanCache = () => {
	planCache.clear();
	planCacheStats.hits = 0;
	planCacheStats.misses = 0;
};

/**
 * Digest of everything `planArrangement` computes from: planner version and its rules, the kit source
 * (plates, solo parts, layout) or 'legacy' / none, and the whole arranger input (parts with roles,
 * quantities, grams, brims and hints, the footprints with their outlines, filament roles, printer, bed
 * margin, spacing, keep-outs, options, unsized parts) plus the learned per-part data. Anything that
 * could not be written out exactly (a function in `options`) is the caller's reason not to cache.
 */
function planKey(
	input: ArrangeInput,
	learned: Map<string, LearnedTime>,
	kit: KitSource | 'legacy' | null,
	version: number
): string {
	const k = !kit || kit === 'legacy' ? kit : { ...kit };
	return createHash('sha256')
		.update(JSON.stringify([version, rulesFor(version), k, input, [...learned]]))
		.digest('hex');
}

/**
 * Plan a build's plates. With a `kit` source the layout comes first (`arrangeFromSource`); without
 * one the arranger runs on its own but keeps kit-solo parts alone. `'legacy'` is the plain arranger
 * as it was before (no source, no brims): only for comparing with arrangements stored back then.
 */
export function planArrangement(
	view: BuildView,
	footprints: Map<string, PrintFootprint>,
	layoutHint: string | null = null,
	options?: ArrangeOptions,
	kit: KitSource | 'legacy' | null = null,
	version: number = PLANNER_VERSION
): Plan | null {
	const input = arrangeInputFor(view, footprints, layoutHint, options);
	if (!input) return null;
	// explicit options (tests, may hold functions) are never cached
	const key = options === undefined ? planKey(input, learnedOf(view), kit, version) : null;
	const hit = key ? planCache.get(key) : undefined;
	if (key && hit) {
		planCache.delete(key); // most recently used goes last
		planCache.set(key, hit);
		planCacheStats.hits++;
		return structuredClone(hit);
	}
	const plan = computePlan(view, input, kit, version);
	if (key) {
		planCacheStats.misses++;
		planCache.set(key, structuredClone(plan));
		if (planCache.size > PLAN_CACHE_MAX) planCache.delete(planCache.keys().next().value!);
	}
	return plan;
}

function computePlan(
	view: BuildView,
	input: ArrangeInput,
	kit: KitSource | 'legacy' | null,
	version: number
): Plan {
	const unsized = (input.unsized ?? []).map((u) => u.slug);
	if (kit === 'legacy') {
		const plain = {
			...input,
			parts: input.parts.map((p) => ({ ...p, brims: undefined }))
		};
		return { result: arrange(plain), unsized, learned: learnedOf(view) };
	}
	if (kit?.plates) {
		const r: SourceArrangeResult = arrangeFromSource(input, kit.plates, rulesFor(version));
		return {
			result: { plates: r.plates, warnings: r.warnings },
			unsized,
			learned: learnedOf(view),
			source: { layout: kit.layout, name: kit.name, kept: r.kept, moves: r.moves }
		};
	}
	return {
		result: arrange({
			...input,
			options: { ...input.options, solo: kit?.solo ?? [] }
		}),
		unsized,
		learned: learnedOf(view)
	};
}

/** `planArrangement` with the kit's source layout looked up for the build. */
export function planForBuild(
	db: Db,
	view: BuildView,
	footprints: Map<string, PrintFootprint>,
	layoutHint: string | null = null,
	version: number = PLANNER_VERSION
): Plan | null {
	return planArrangement(view, footprints, layoutHint, undefined, loadKitSource(db, view), version);
}

export interface LayoutPlacement {
	/** The build's plates (the Print tab's numbers, names, runs and parts), with positions; plates that had to give up parts or bed room are followed by new ones. */
	plates: ArrangedPlate[];
	/** Plates whose parts needed more than one bed here: the number, name and how many extra plates were added. */
	overflow: { number: number; name: string; extra: number }[];
	/** Parts that are not on their source plate any more, and why. */
	moves: SourceMove[];
}

/**
 * Place the build's existing plates (a MakeGood layout or the maker's file carries membership only, no
 * positions) flat on the bed: the plate numbers, names and part grouping stay exactly as on the Print
 * tab (`arrangeFromSource`). Only a part whose filament no longer matches its plate, or whose plate
 * does not fit this bed, leaves it, for a new plate numbered after the last. Only flat Z rotations
 * (see `arrange.ts`). Null without a printer.
 */
export function placeOnPlates(
	view: BuildView,
	footprints: Map<string, PrintFootprint>,
	layoutHint: string | null = null
): LayoutPlacement | null {
	const input = arrangeInputFor(view, footprints, layoutHint);
	if (!input) return null;
	const source: SourcePlate[] = view.plates.map((pl) => ({
		number: pl.number,
		name: pl.name,
		runs: pl.runs,
		...(pl.perPartRuns ? { perPartRuns: true } : {}),
		parts: pl.parts
	}));
	const r = arrangeFromSource(input, source);
	const byNumber = new Map(view.plates.map((p) => [p.number, p]));
	const extra = new Map<number, Set<number>>();
	for (const m of r.moves)
		if (m.reason === 'bed' && m.from != null)
			extra.set(m.from, (extra.get(m.from) ?? new Set()).add(m.to));
	return {
		plates: r.plates,
		overflow: [...extra].map(([number, to]) => ({
			number,
			name: byNumber.get(number)?.name ?? `Plate ${number}`,
			extra: to.size
		})),
		moves: r.moves
	};
}

/** Stable identity of a plate set: what is on each plate in which color, no positions. */
export function signature(plates: Pick<ArrangedPlate, 'parts' | 'roles' | 'runs'>[]): string {
	return plates
		.map((pl) => `${[...pl.parts].sort().join(',')}|${[...pl.roles].sort().join(',')}|${pl.runs}`)
		.sort()
		.join(';');
}

/** The build's plate-attached print logs (they would be orphaned by replacing plates). */
export const hasPlateRuns = (view: BuildView) => view.runs.some((r) => r.plateNumber != null);

/** What survives a plate replacement: typed time and typed grams (see `manualTimes`). */
export interface PlateManuals {
	manualEstSeconds: number | null;
	manualEstSource: 'user' | 'printer' | null;
	/** Typed plate grams; only present when the old plate's grams were typed by hand. */
	typedGrams?: {
		slicerGrams: number | null;
		slicerByPart: Record<string, number>;
		slicerGramsSource: 'user';
	};
}

/**
 * Manual plate times and typed plate grams keyed for carrying over when plates are replaced: a new
 * plate keeps the old plate's manual time (and typed grams, source 'user') when it has the same
 * number and the same set of parts. A plate that was renumbered (the kit numbers its plates its own way,
 * an arrangement made before that numbered them 1, 2, 3...) still keeps them when it holds exactly the
 * same parts, is printed as often and is of the same kind (`shape`: runs, per-part runs); that match is
 * used once and only when it is unambiguous
 * (an exact number + parts match elsewhere in `planned` always has priority). Grams that came from a file or a printer job are not carried:
 * the new plates have their own source.
 */
export function manualTimes(
	tx: Db,
	buildId: string,
	/** The plates about to be written: each exact match is reserved before any renumbered match, so call order cannot matter. */
	planned: { number: number; parts: string[] }[]
): (
	number: number,
	parts: string[],
	shape?: { runs: number; perPartRuns?: boolean }
) => PlateManuals {
	const old = tx.select().from(buildPlates).where(eq(buildPlates.buildId, buildId)).all();
	const setKey = (parts: string[]) => [...parts].sort().join(',');
	const key = (n: number, parts: string[]) => `${n}:${setKey(parts)}`;
	const shapeKey = (parts: string[], runs: number, perPart?: boolean) =>
		`${setKey(parts)}|${runs}|${perPart ? 1 : 0}`;
	const m = new Map<string, PlateManuals>();
	const bySet = new Map<string, { k: string; h: PlateManuals }[]>();
	for (const o of old) {
		const typed =
			gramsSourceOf(o, undefined, false) === 'user' &&
			((o.slicerGrams ?? 0) > 0 || Object.values(o.slicerByPart).some((v) => v > 0));
		if (!o.manualEstSeconds && !typed) continue;
		const h: PlateManuals = {
			manualEstSeconds: o.manualEstSeconds ?? null,
			manualEstSource: o.manualEstSeconds ? (o.manualEstSource ?? 'user') : null,
			typedGrams: typed
				? {
						slicerGrams: o.slicerGrams,
						slicerByPart: o.slicerByPart,
						slicerGramsSource: 'user'
					}
				: undefined
		};
		const k = key(o.number, o.parts);
		m.set(k, h);
		const sk = shapeKey(o.parts, o.runs, o.perPartRuns);
		bySet.set(sk, [...(bySet.get(sk) ?? []), { k, h }]);
	}
	// an exact match belongs to its plate whatever order the plates are asked in: a renumbered match never takes it
	const reserved = new Set(planned.map((p) => key(p.number, p.parts)).filter((k) => m.has(k)));
	const taken = new Set<string>(); // each stored value goes to one new plate only
	return (number, parts, shape) => {
		const k = key(number, parts);
		const exact = m.get(k);
		if (exact && !taken.has(k)) {
			taken.add(k);
			return exact;
		}
		const same = shape ? (bySet.get(shapeKey(parts, shape.runs, shape.perPartRuns)) ?? []) : [];
		if (same.length === 1 && !reserved.has(same[0].k) && !taken.has(same[0].k)) {
			taken.add(same[0].k);
			return same[0].h;
		}
		return { manualEstSeconds: null, manualEstSource: null };
	};
}

/** Column values to spread into an insert: the carried time, and typed grams when there are any. */
export function carryManuals(h: PlateManuals) {
	const { typedGrams, ...time } = h;
	return { ...time, ...(typedGrams ?? {}) };
}

/** Replace the build's plates with a plan. Callers must have dealt with plate-attached runs. */
export function writePlan(
	tx: Db,
	buildId: string,
	plan: Plan,
	/** Planner version stamped on the plates (`PLANNER_VERSION`); older ones only for tests of stored arrangements. */
	version: number = PLANNER_VERSION
): number {
	const tplId = tx
		.select({ t: builds.templateId })
		.from(builds)
		.where(eq(builds.id, buildId))
		.get()?.t;
	// MakeGood's X/P/A times, spread over the plate's items (an estimate; the view recomputes it too)
	const est = tplId
		? estimateArrangedPlates(
				loadTimeModel(tx, tplId, plan.learned),
				plan.result.plates.map((pl) => ({
					number: pl.number,
					runs: pl.runs,
					arrangement: pl,
					parts: pl.parts
				}))
			)
		: null;
	const manualFor = manualTimes(
		tx,
		buildId,
		plan.result.plates.map((pl) => ({ number: pl.number, parts: pl.parts }))
	);
	tx.delete(buildPlates).where(eq(buildPlates.buildId, buildId)).run();
	for (const pl of plan.result.plates)
		tx.insert(buildPlates)
			.values({
				buildId,
				number: pl.number,
				name: pl.name,
				estSeconds: est?.get(pl.number)?.estSeconds ?? null,
				runs: pl.runs,
				perPartRuns: !!pl.perPartRuns,
				parts: pl.parts,
				...carryManuals(
					manualFor(pl.number, pl.parts, { runs: pl.runs, perPartRuns: !!pl.perPartRuns })
				),
				source: ARRANGED_SOURCE,
				arrangement: { ...pl, v: version }
			})
			.run();
	tx.update(builds).set({ plateLayout: ARRANGED_LAYOUT }).where(eq(builds.id, buildId)).run();
	return plan.result.plates.length;
}

/**
 * After a change that moves parts between colors or switches variants or printer:
 * if the build's plates are arranged and no print log hangs on a plate, arrange again.
 * Returns whether plates were rewritten. With plate logs, or once the build has started
 * (`view.started`: any run, part not To print, Printing part or live printer job) it does nothing
 * (the UI offers "re-arrange" and asks first).
 */
export function autoRearrange(
	tx: Db,
	buildId: string,
	view: BuildView,
	footprints: Map<string, PrintFootprint>,
	layoutHint: string | null
): boolean {
	const b = tx
		.select({ layout: builds.plateLayout })
		.from(builds)
		.where(and(eq(builds.id, buildId)))
		.get();
	if (b?.layout !== ARRANGED_LAYOUT || hasPlateRuns(view)) return false;
	// A build that has started printing keeps its plates: rewriting them renumbers plates under a
	// live printer job and under Printing parts. The plates go stale instead (banner offers a
	// deliberate "Re-arrange"). Issue #56.
	if (view.started.started) return false;
	const plan = planArrangement(view, footprints, layoutHint, undefined, loadKitSource(tx, view));
	if (!plan) return false;
	writePlan(tx, buildId, plan);
	return true;
}

/** Activity kinds after which arranged plates are re-arranged by `mutateBuild`. */
export const REARRANGE_KINDS = new Set([
	'design.update',
	'design.apply',
	'build.variant',
	'build.printer',
	'part.skip',
	'part.restore',
	'custom.add',
	'custom.remove'
]);

/** Advice appended to oversize warnings when the kit has other (printer-specific) layouts. */
export function layoutHintFor(db: Db, templateId: string): string | null {
	const layouts = db
		.select({ name: templatePlateLayouts.name, isDefault: templatePlateLayouts.isDefault })
		.from(templatePlateLayouts)
		.where(eq(templatePlateLayouts.templateId, templateId))
		.all();
	if (layouts.length < 2) return null;
	return 'The MakeGood layouts in the picker may print it in another orientation.';
}

/** `autoRearrange` with its inputs loaded; used by `mutateBuild` right after a mutation. */
export function autoRearrangeBuild(tx: Db, buildId: string, userId: string): boolean {
	const view = loadBuildView(tx, buildId, userId);
	if (!view) return false;
	return autoRearrange(
		tx,
		buildId,
		view,
		loadFootprints(tx, view.build.templateId),
		layoutHintFor(tx, view.build.templateId)
	);
}
