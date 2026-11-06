/**
 * Server side of the plate arranger: turns a `BuildView` plus the template's print
 * footprints into `arrange()` input, and writes the result as the build's plates
 * (`source = 'arranged'`, positions in `build_plates.arrangement`).
 *
 * Kept free of `mutateBuild` so it can be called from inside it (automatic
 * re-arrange after a color / variant / printer change).
 */
import { and, eq } from 'drizzle-orm';
import {
	arrange,
	type ArrangeOptions,
	type ArrangePart,
	type ArrangeResult,
	type ArrangeRole,
	type ArrangedPlate
} from '#lib/domain/arrange.ts';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import type { BuildView } from '#lib/domain/types.ts';
import { effectiveKeepOut } from '#lib/printers/printer.ts';
import type { Db } from '../db';
import { buildPlates, builds, templatePlateLayouts, templatePrintGeometry } from '../db/schema';
import { loadBuildView } from './view';
import { estimateArrangedPlates, loadTimeModel } from './time-model';
import { ensureOrientations, ensureSilhouettes } from '../print-geometry/store';

export const ARRANGED_LAYOUT = 'arranged';
export const ARRANGED_SOURCE = 'arranged';

/** Edge margin stored by builds planned before the default became 1 mm; read as the new default. */
export const OLD_DEFAULT_MARGIN = 5;
export const NEW_DEFAULT_MARGIN = 1;
export const effectiveMargin = (m: number) => (m === OLD_DEFAULT_MARGIN ? NEW_DEFAULT_MARGIN : m);

const TEMPLATE_ROLE_NAMES = /^[a-z]+$/;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Print footprints stored for a template, by slug (seed rows and imported rows alike). */
export function loadFootprints(db: Db, templateId: string): Map<string, PrintFootprint> {
	ensureOrientations(db, templateId);
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
}

/** Role labels for plate names: the kit's own slots by key ("Accent"), added colors by name. */
function roleLabel(f: BuildView['filaments'][number]): string {
	return TEMPLATE_ROLE_NAMES.test(f.key) && f.key.length <= 12 ? cap(f.key) : f.name;
}

export function planArrangement(
	view: BuildView,
	footprints: Map<string, PrintFootprint>,
	layoutHint: string | null = null,
	options?: ArrangeOptions
): Plan | null {
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
		const grams = part.bomGrams != null ? Math.round((part.bomGrams / units) * 10) / 10 : null;
		const fp = footprints.get(part.slug);
		if (!fp) {
			unsized.push({ slug: part.slug, name: part.name, role: part.role, grams: part.bomGrams });
			continue;
		}
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
			hint: bits.join(' ') || null
		});
	}
	const result = arrange({
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
	});
	return { result, unsized: unsized.map((u) => u.slug) };
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

/** Replace the build's plates with a plan. Callers must have dealt with plate-attached runs. */
export function writePlan(tx: Db, buildId: string, plan: Plan): number {
	const tplId = tx
		.select({ t: builds.templateId })
		.from(builds)
		.where(eq(builds.id, buildId))
		.get()?.t;
	// MakeGood's X/P/A times, spread over the plate's items (an estimate; the view recomputes it too)
	const est = tplId
		? estimateArrangedPlates(
				loadTimeModel(tx, tplId),
				plan.result.plates.map((pl) => ({
					number: pl.number,
					runs: pl.runs,
					arrangement: pl,
					parts: pl.parts
				}))
			)
		: null;
	tx.delete(buildPlates).where(eq(buildPlates.buildId, buildId)).run();
	for (const pl of plan.result.plates)
		tx.insert(buildPlates)
			.values({
				buildId,
				number: pl.number,
				name: pl.name,
				estSeconds: est?.get(pl.number)?.estSeconds ?? null,
				runs: pl.runs,
				perPartRuns: false,
				parts: pl.parts,
				source: ARRANGED_SOURCE,
				arrangement: pl
			})
			.run();
	tx.update(builds).set({ plateLayout: ARRANGED_LAYOUT }).where(eq(builds.id, buildId)).run();
	return plan.result.plates.length;
}

/**
 * After a change that moves parts between colors or switches variants or printer:
 * if the build's plates are arranged and no print log hangs on a plate, arrange again.
 * Returns whether plates were rewritten. With plate logs it does nothing (the UI offers
 * "re-arrange" and asks before converting the logs).
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
	const plan = planArrangement(view, footprints, layoutHint);
	if (!plan) return false;
	writePlan(tx, buildId, plan);
	return true;
}

/** Activity kinds after which arranged plates are re-arranged by `mutateBuild`. */
export const REARRANGE_KINDS = new Set([
	'design.update',
	'design.apply',
	'build.variant',
	'build.printer'
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
