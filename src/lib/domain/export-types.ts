/** Shared types of the 3MF export (server and UI). Browser-safe. */

export type Flavor = 'orca' | 'bambu' | 'plain';
export const FLAVORS: Flavor[] = ['orca', 'bambu', 'plain'];

export type ExportWarningCode =
	'no-geometry' | 'slots' | 'oversize' | 'bed' | 'arrangement' | 'empty-plate' | 'height';

export interface ExportWarning {
	code: ExportWarningCode;
	/** `error`: the file is written but the plate cannot be printed as is. */
	severity: 'info' | 'warn' | 'error';
	message: string;
	slug?: string;
	plate?: number;
}

export interface PreviewObject {
	name: string;
	slug: string;
	role: string;
	filamentIndex: number;
	count: number;
}

/** Response of GET /api/builds/[id]/export/preview. */
export interface ExportPreview {
	flavor: Flavor;
	printer: { name: string; bedX: number; bedY: number; mmSlots: number };
	/** False when nothing can be exported (no geometry imported). */
	ready: boolean;
	reason: 'no-geometry' | null;
	plates: {
		index: number;
		number: number;
		name: string;
		runs: number;
		objects: PreviewObject[];
		items: number;
		roles: string[];
	}[];
	filaments: {
		index: number;
		key: string;
		label: string;
		name: string;
		material: string;
		type: string;
		hex: string;
		used: boolean;
	}[];
	warnings: ExportWarning[];
	missing: { slug: string; name: string }[];
	/** Files a download gives: plain exports one 3MF per plate (zipped when several). */
	files: number;
}
