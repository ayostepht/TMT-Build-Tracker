/**
 * Match a file name reported by a printer to a build plate. Pure.
 *
 * Our 3MF export names files `TMT-<build>-<printer>-<flavor>[-plateN].3mf` and plates inside
 * `plate-NN-<plate name>.3mf`; users also save "Plate 3 - Wings (Accent)" style names from the
 * slicer. We look for a plate number after the word "plate", or a plate name in the file name.
 */
import type { BuildView } from './types.ts';

export function normalizeFileName(name: string): string {
	return name
		.replace(/^.*[\\/]/, '')
		.replace(/\.(gcode|3mf|bgcode|gco)(\.3mf|\.gcode)?$/i, '')
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export interface PlateRef {
	number: number;
	name: string;
}

/** Plate number for a file name, or null when nothing (or nothing unambiguous) matches. */
export function matchPlate(fileName: string, plates: PlateRef[]): number | null {
	const f = ` ${normalizeFileName(fileName)} `;
	if (f.trim() === '') return null;

	// Longest plate-name match first: names are the most specific signal.
	const byName = plates
		.map((p) => ({ n: p.number, name: normalizeFileName(p.name) }))
		.filter((p) => p.name.length >= 4 && f.includes(` ${p.name} `))
		.sort((a, b) => b.name.length - a.name.length);
	const m = /(?:^|\s)plate\s*0*(\d{1,3})(?=\s|$)/.exec(f);
	const byNumber = m ? Number(m[1]) : null;
	const numberOk = byNumber !== null && plates.some((p) => p.number === byNumber);

	if (numberOk && byName.length && byName[0].n !== byNumber) {
		// Number and name disagree: the number is what we wrote into exported files.
		return byNumber;
	}
	if (numberOk) return byNumber;
	if (byName.length === 1 || (byName.length > 1 && byName[0].name.length > byName[1].name.length))
		return byName[0].n;
	return null;
}

/** True when the build's name appears in the file name (used to choose between builds). */
export function fileMentionsBuild(fileName: string, buildName: string): boolean {
	const b = normalizeFileName(buildName);
	return b.length >= 3 && ` ${normalizeFileName(fileName)} `.includes(` ${b} `);
}

/**
 * Grams a finished plate print should be logged with: the slicer weight of the plate, or
 * the sum of the per-part weights for plates that print each part separately.
 */
export function plateRunGrams(
	view: BuildView,
	plateNumber: number,
	partSlugs?: string[]
): number | null {
	const plate = view.plates.find((p) => p.number === plateNumber);
	if (!plate) return null;
	if (plate.perPartRuns) {
		const slugs = partSlugs?.length ? partSlugs : plate.parts;
		const sum = slugs.reduce((a, s) => a + (plate.slicerByPart[s] ?? 0), 0);
		return sum > 0 ? sum : null;
	}
	return plate.slicerGrams && plate.slicerGrams > 0 ? plate.slicerGrams : null;
}
