import type { Plate } from '#lib/domain/types.ts';

/**
 * A plate with exactly one part that prints once. On the Print tab grouped by plate, the part row's
 * status badge stands for the plate here and the plate heading shows no badge of its own.
 */
export function isSoloPlate(plate: Plate | null | undefined): boolean {
	return !!plate && plate.parts.length === 1 && !plate.perPartRuns && plate.runs <= 1;
}
