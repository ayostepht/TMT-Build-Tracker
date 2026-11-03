/**
 * Convert the original single-page prototype's saved state into this app's
 * build progress. Pure: takes a `BuildView` (for the valid part slugs, plate
 * numbers and filament roles) and the export, returns patches and inputs for
 * the server to persist. Problems in the data become warnings, never throws,
 * except for a wrong `format`.
 */
import {
	PART_STATUSES,
	RUN_RESULTS,
	type BuildView,
	type PartPatch,
	type PartStatus,
	type PrintRunInput,
	type RunResult
} from './types.ts';

export const PROTOTYPE_FORMAT = 'tmt-prototype-v1';

/** The prototype's filament keys and the template roles they correspond to. */
export const PROTOTYPE_FILAMENT_ROLES: Record<string, string> = {
	ob: 'primary',
	db: 'accent',
	tdb: 'soft',
	tbk: 'tire'
};

export interface PrototypeLogEntry {
	d?: string;
	r?: string;
	g?: number | null;
	h?: number | null;
	note?: string;
	part?: string;
	parts?: string[];
}

export interface PrototypePartDoc {
	status?: string;
	printed?: string;
	started?: string;
	runEst?: number | null;
	comps?: Record<string, boolean>;
	log?: PrototypeLogEntry[];
	[extra: string]: unknown; // legacy fields such as runG, updatedAt
}

export interface PrototypePlateDoc {
	log?: PrototypeLogEntry[];
	slicerG?: number | null;
	slicerByPart?: Record<string, number>;
	[extra: string]: unknown;
}

export interface PrototypeExport {
	format: typeof PROTOTYPE_FORMAT;
	parts: Record<string, PrototypePartDoc>;
	plates: Record<string, PrototypePlateDoc>;
	settings?: { filament?: { spools?: Record<string, number> } };
}

export interface ImportCounts {
	parts: number;
	runs: number;
	plates: number;
	spools: number;
}

export interface PrototypeConversion {
	patches: PartPatch[];
	runs: PrintRunInput[];
	plates: { number: number; slicerGrams: number | null; slicerByPart: Record<string, number> }[];
	spools: { role: string; spools: number }[];
	warnings: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isDate = (v: unknown): v is string =>
	typeof v === 'string' &&
	/^\d{4}-\d{2}-\d{2}$/.test(v) &&
	!Number.isNaN(Date.parse(v + 'T00:00:00Z')) &&
	new Date(v + 'T00:00:00Z').toISOString().startsWith(v);
const nonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function importCounts(
	c: Pick<PrototypeConversion, 'patches' | 'runs' | 'plates' | 'spools'>
) {
	return {
		parts: c.patches.length,
		runs: c.runs.length,
		plates: c.plates.length,
		spools: c.spools.length
	} satisfies ImportCounts;
}

export function convertPrototype(view: BuildView, data: PrototypeExport): PrototypeConversion {
	if (!isObj(data) || (data as Obj).format !== PROTOTYPE_FORMAT)
		throw new Error(`Not a prototype export (expected format "${PROTOTYPE_FORMAT}")`);
	const src = data as Obj;
	const warnings: string[] = [];
	const patches: PartPatch[] = [];
	const runs: PrintRunInput[] = [];
	const plates: PrototypeConversion['plates'] = [];
	const spools: PrototypeConversion['spools'] = [];

	/** Validate one log entry; null (plus a warning) when unusable. */
	function entry(raw: unknown, where: string): Obj | null {
		if (!isObj(raw)) {
			warnings.push(`${where}: log entry is not an object, skipped`);
			return null;
		}
		if (!(RUN_RESULTS as readonly unknown[]).includes(raw.r)) {
			warnings.push(`${where}: unknown result, entry skipped`);
			return null;
		}
		if (!isDate(raw.d)) {
			warnings.push(`${where}: invalid date, entry skipped`);
			return null;
		}
		return raw;
	}
	function toRun(
		e: Obj,
		where: string,
		target: Pick<PrintRunInput, 'plateNumber' | 'partSlug' | 'partSlugs'>
	): PrintRunInput {
		const num = (v: unknown, field: string) => {
			if (v === null || v === undefined || v === '') return null;
			if (nonNeg(v)) return v;
			warnings.push(`${where}: ${field} ignored (not a number >= 0)`);
			return null;
		};
		return {
			...target,
			date: e.d as string,
			result: e.r as RunResult,
			grams: num(e.g, 'grams'),
			hours: num(e.h, 'hours'),
			printer: null,
			note: typeof e.note === 'string' ? e.note.slice(0, 2000) : ''
		};
	}

	// Parts
	const partDocs = isObj(src.parts) ? src.parts : {};
	if (!isObj(src.parts)) warnings.push('parts is missing or not an object');
	for (const [id, raw] of Object.entries(partDocs)) {
		if (!view.state[id]) {
			warnings.push(`Part "${id}" is not in this build, skipped`);
			continue;
		}
		if (!isObj(raw)) {
			warnings.push(`Part "${id}": not an object, skipped`);
			continue;
		}
		let status: PartStatus = 'To print';
		if ((PART_STATUSES as readonly unknown[]).includes(raw.status))
			status = raw.status as PartStatus;
		else if (raw.status !== undefined)
			warnings.push(`Part "${id}": unknown status, treated as To print`);

		let printedOn: string | null = null;
		if (raw.printed !== undefined && raw.printed !== '' && raw.printed !== null) {
			if (isDate(raw.printed)) printedOn = raw.printed;
			else warnings.push(`Part "${id}": invalid printed date ignored`);
		}
		let startedAt: string | null = null;
		let runEstSeconds: number | null = null;
		if (status === 'Printing') {
			if (typeof raw.started === 'string' && raw.started) {
				const t = Date.parse(raw.started);
				if (Number.isNaN(t)) warnings.push(`Part "${id}": invalid start time ignored`);
				else startedAt = new Date(t).toISOString();
			}
			if (raw.runEst !== undefined && raw.runEst !== null) {
				if (nonNeg(raw.runEst)) runEstSeconds = Math.round(raw.runEst);
				else warnings.push(`Part "${id}": invalid time estimate ignored`);
			}
		}
		const comps: Record<string, boolean> = {};
		if (raw.comps !== undefined) {
			if (isObj(raw.comps)) {
				for (const [k, v] of Object.entries(raw.comps)) {
					if (typeof v === 'boolean') comps[String(k)] = v;
					else warnings.push(`Part "${id}": component ${k} is not true/false, ignored`);
				}
			} else warnings.push(`Part "${id}": comps is not an object, ignored`);
		}
		const log = Array.isArray(raw.log) ? raw.log : [];
		if (raw.log !== undefined && !Array.isArray(raw.log))
			warnings.push(`Part "${id}": log is not a list, ignored`);
		for (const [i, le] of log.entries()) {
			const e = entry(le, `Part "${id}" log #${i + 1}`);
			if (e)
				runs.push(
					toRun(e, `Part "${id}" log #${i + 1}`, {
						plateNumber: null,
						partSlug: id,
						partSlugs: null
					})
				);
		}
		const hasComps = Object.values(comps).some(Boolean);
		if (status !== 'To print' || printedOn || hasComps)
			patches.push({ slug: id, status, startedAt, printedOn, runEstSeconds, comps });
	}

	// Plates
	const plateDocs = isObj(src.plates) ? src.plates : {};
	if (!isObj(src.plates)) warnings.push('plates is missing or not an object');
	for (const [key, raw] of Object.entries(plateDocs)) {
		const n = /^\d+$/.test(key) ? Number(key) : NaN;
		const plate = view.plates.find((p) => p.number === n);
		if (!plate) {
			warnings.push(`Plate "${key}" is not in this build, skipped`);
			continue;
		}
		if (!isObj(raw)) {
			warnings.push(`Plate ${n}: not an object, skipped`);
			continue;
		}
		let slicerGrams: number | null = null;
		if (raw.slicerG !== undefined && raw.slicerG !== null) {
			if (nonNeg(raw.slicerG)) slicerGrams = raw.slicerG;
			else warnings.push(`Plate ${n}: invalid slicer weight ignored`);
		}
		const slicerByPart: Record<string, number> = {};
		if (raw.slicerByPart !== undefined && raw.slicerByPart !== null) {
			if (isObj(raw.slicerByPart)) {
				for (const [slug, g] of Object.entries(raw.slicerByPart)) {
					if (!plate.parts.includes(slug))
						warnings.push(`Plate ${n}: part "${slug}" is not on it, ignored`);
					else if (!nonNeg(g))
						warnings.push(`Plate ${n}: invalid slicer weight for "${slug}" ignored`);
					else slicerByPart[slug] = g;
				}
			} else warnings.push(`Plate ${n}: slicerByPart is not an object, ignored`);
		}
		if (slicerGrams !== null || Object.keys(slicerByPart).length)
			plates.push({ number: n, slicerGrams, slicerByPart });

		const log = Array.isArray(raw.log) ? raw.log : [];
		if (raw.log !== undefined && !Array.isArray(raw.log))
			warnings.push(`Plate ${n}: log is not a list, ignored`);
		for (const [i, le] of log.entries()) {
			const where = `Plate ${n} log #${i + 1}`;
			const e = entry(le, where);
			if (!e) continue;
			let partSlug: string | null = null;
			let partSlugs: string[] | null = null;
			if (e.part !== undefined && e.part !== null && e.part !== '') {
				if (typeof e.part !== 'string' || !view.state[e.part]) {
					warnings.push(`${where}: unknown part, entry skipped`);
					continue;
				}
				partSlug = e.part;
			} else if (e.parts !== undefined && e.parts !== null) {
				if (!Array.isArray(e.parts)) {
					warnings.push(`${where}: parts is not a list, entry skipped`);
					continue;
				}
				const known = [
					...new Set(e.parts.filter((s): s is string => typeof s === 'string' && !!view.state[s]))
				];
				if (known.length !== new Set(e.parts).size)
					warnings.push(`${where}: some parts are not in this build, ignored`);
				if (!known.length && e.parts.length) {
					warnings.push(`${where}: none of its parts are in this build, entry skipped`);
					continue;
				}
				partSlugs = known.length ? known : null;
			}
			runs.push(toRun(e, where, { plateNumber: n, partSlug, partSlugs }));
		}
	}

	// Spools
	const spoolDocs =
		isObj(src.settings) && isObj(src.settings.filament) ? src.settings.filament.spools : undefined;
	if (spoolDocs !== undefined) {
		if (!isObj(spoolDocs)) warnings.push('Spools: not an object, ignored');
		else
			for (const [key, v] of Object.entries(spoolDocs)) {
				const role = PROTOTYPE_FILAMENT_ROLES[key];
				if (!role || !view.filaments.some((f) => f.key === role)) {
					warnings.push(`Spools: filament "${key}" has no matching role in this build, skipped`);
					continue;
				}
				if (!nonNeg(v) || v > 99) {
					warnings.push(`Spools: invalid count for "${key}", skipped`);
					continue;
				}
				spools.push({ role, spools: Math.round(v * 100) / 100 });
			}
	}

	runs.sort((a, b) => a.date.localeCompare(b.date));
	return { patches, runs, plates, spools, warnings };
}
