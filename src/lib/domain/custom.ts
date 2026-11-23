/**
 * Custom pieces: non-standard accessories or beta replacements a maker uploaded as a 3MF.
 * Their parts are in `BuildView.parts` (section 'Custom') but never in `allParts`, and their plates
 * carry `source = 'custom:<pieceId>'`. Pure: no DB, Svelte or Node imports.
 */
import type { BuildView, PartDef, Plate } from './types.ts';

export const CUSTOM_SECTION = 'Custom';
export const MAX_CUSTOM_PIECES = 20;
export const MAX_CUSTOM_PLATES = 30;
export const CUSTOM_NAME_MAX = 80;

const PREFIX = 'custom:';

/** `build_plates.source` of a custom piece's plate. */
export const isCustomSource = (source: string | null | undefined): boolean =>
	typeof source === 'string' && source.startsWith(PREFIX) && source.length > PREFIX.length;

export const isCustomPlate = (plate: Pick<Plate, 'source'>): boolean =>
	isCustomSource(plate.source);

/** The piece id in a `custom:<pieceId>` source, null for any other source. */
export const customPieceIdOf = (source: string | null | undefined): string | null =>
	isCustomSource(source) ? (source as string).slice(PREFIX.length) : null;

/** A part by slug: active parts first, then every template part (inactive variants); custom parts are in `parts`. */
export function partBySlug(
	view: Pick<BuildView, 'parts' | 'allParts'>,
	slug: string
): PartDef | undefined {
	return view.parts.find((p) => p.slug === slug) ?? view.allParts.find((p) => p.slug === slug);
}

/**
 * The view without custom parts, custom plates and custom state: what the arranger and the 3MF export
 * (kit parts only) work on. Runs and everything else stay as they are.
 */
export function kitOnly(view: BuildView): BuildView {
	const custom = new Set(view.parts.filter((p) => p.custom).map((p) => p.slug));
	const state = Object.fromEntries(Object.entries(view.state).filter(([s]) => !custom.has(s)));
	return {
		...view,
		parts: view.parts.filter((p) => !p.custom),
		state,
		plates: view.plates.filter((p) => !isCustomPlate(p)),
		skipped: view.skipped.filter((s) => !s.custom),
		customPieces: []
	};
}
