/**
 * Types and pure helpers for a parsed slicer 3MF (Milestone 5). The streaming
 * parser lives in `src/lib/server/threemf/`; this file is shared with the
 * matcher and the UI, so it has no Node imports.
 */

export interface ThreeMfObject {
	/** Id of the first object with this name in the file. */
	id: string;
	name: string;
	/** 1-based filament index (Bambu/Orca `extruder`); null when unknown. */
	filamentIndex: number | null;
	/** Instances of this object on the plate (duplicate names are summed). */
	count: number;
}

export interface ThreeMfFilament {
	index: number; // 1-based
	type: string; // PETG, PLA, TPU, ...
	color: string | null; // #RRGGBB (may be a placeholder)
	name?: string;
}

export interface ThreeMfPlate {
	index: number; // plate number in the file, 1-based
	name: string;
	/** Number of prints encoded in the name, e.g. "WHEEL RIM (PRINT X4)" is 4; 1 otherwise. */
	runsHint: number;
	estSeconds: number | null; // per run, sliced files only
	grams: number | null; // per run, sliced files only
	/** Grams per run by 1-based filament index (as a string key), sliced files only. */
	filamentGrams: Record<string, number>;
	/** Per-object cost measured from the plate's G-code, when it names its objects (see `attachGcodeObjectStats`). */
	exact?: ExactObject[];
	thumbnail?: Uint8Array; // PNG; absent when the file has none or after `toStoredSummary`
	objects: ThreeMfObject[];
}

export interface ThreeMfSummary {
	/** Application metadata, e.g. "BambuStudio-02.06.00.51". */
	app: string | null;
	/** `project`: Bambu/Orca-family file with plates; `plain`: objects only. */
	kind: 'project' | 'plain';
	sliced: boolean;
	printer: string | null;
	nozzle: number | null;
	layerHeight: number | null;
	filaments: ThreeMfFilament[];
	plates: ThreeMfPlate[];
	/** Things worth telling the user (skipped oversized entries, truncated scans). */
	warnings: string[];
}

/** The JSON-safe form kept in `build_uploads.summary` and sent to the browser: thumbnails become a flag. */
export type StoredPlate = Omit<ThreeMfPlate, 'thumbnail'> & { hasThumbnail: boolean };
export type StoredSummary = Omit<ThreeMfSummary, 'plates'> & { plates: StoredPlate[] };

export function toStoredSummary(s: ThreeMfSummary): StoredSummary {
	return {
		...s,
		plates: s.plates.map(({ thumbnail, ...p }) => ({ ...p, hasThumbnail: !!thumbnail }))
	};
}

const NAMED: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

/** Decodes XML/HTML entities (also when a name was escaped twice, as some exporters do). */
export function decodeEntities(s: string): string {
	let cur = s;
	for (let i = 0; i < 2 && cur.includes('&'); i++) {
		cur = cur.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
			if (e[0] === '#') {
				const code =
					e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
				try {
					return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
				} catch {
					return m;
				}
			}
			return NAMED[e.toLowerCase()] ?? m;
		});
	}
	return cur;
}

/** "WHEEL RIM (PRINT X4)" → 4, "(x2)" → 2, "print 3 times" → 3; 1 when the name says nothing. */
export function runsHintFromName(name: string): number {
	const pats = [
		/\bprint\s*(?:x|×)\s*(\d{1,2})\b/i,
		/\bprint\s*(\d{1,2})\s*(?:x|×|times)\b/i,
		/\(\s*(?:x|×)\s*(\d{1,2})\s*\)/i,
		/\(\s*(\d{1,2})\s*(?:x|×)\s*\)/i,
		/\bprint\s+(\d{1,2})\b/i
	];
	for (const p of pats) {
		const m = p.exec(name);
		if (m) {
			const n = Number(m[1]);
			if (n >= 1 && n <= 99) return n;
		}
	}
	return 1;
}

/**
 * What one object name cost on a plate, measured from the plate's G-code (all copies of the object added
 * up): seconds on the slicer's time scale and extruded mm by 1-based filament index (as a string key).
 */
export interface ExactObject {
	name: string;
	seconds: number;
	mm: Record<string, number>;
}
