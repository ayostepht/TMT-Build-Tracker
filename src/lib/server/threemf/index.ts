/**
 * Streaming 3MF reader for slicer project files (Milestone 5).
 *
 * Supports Bambu Studio and the OrcaSlicer family (Elegoo Slicer, ...) project
 * files, which share the `Metadata/` layout (`model_settings.config`,
 * `slice_info.config` when sliced, `project_settings.config` JSON, `plate_N.png`
 * thumbnails), and plain 3MF files (objects only, read from `3D/3dmodel.model`).
 *
 * The zip is streamed with fflate's `Unzip`: only the wanted entries are ever
 * inflated (`3D/Objects/*` geometry, which dominates a 90 MB file, never is),
 * each with a size cap. A file of 88 MB is read in about 1.5 s.
 */
import { createReadStream } from 'node:fs';
import { Unzip, UnzipInflate, UnzipPassThrough, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import {
	decodeEntities,
	runsHintFromName,
	type ThreeMfFilament,
	type ThreeMfObject,
	type ThreeMfPlate,
	type ThreeMfSummary
} from '#lib/domain/threemf.ts';

export class ThreeMfError extends Error {}

export interface ParseLimits {
	/** Max inflated size of a config entry (model_settings, slice_info, project_settings). */
	maxConfigBytes: number;
	/** Max inflated size of one thumbnail PNG; larger ones are dropped with a warning. */
	maxThumbBytes: number;
	/** Max inflated bytes scanned from `3D/3dmodel.model`. */
	maxModelBytes: number;
	/** Max zip entries looked at. */
	maxEntries: number;
}
export const DEFAULT_LIMITS: ParseLimits = {
	maxConfigBytes: 64 * 1024 * 1024,
	maxThumbBytes: 8 * 1024 * 1024,
	maxModelBytes: 512 * 1024 * 1024,
	maxEntries: 200_000
};

const CONFIGS = new Set([
	'Metadata/model_settings.config',
	'Metadata/slice_info.config',
	'Metadata/project_settings.config',
	'Metadata/Slic3r_PE_model.config'
]);
const THUMB_RE = /^Metadata\/plate_(\d+)(_small)?\.png$/;
const MODEL = '3D/3dmodel.model';

type Source = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

interface Raw {
	configs: Map<string, Uint8Array>;
	thumbs: Map<string, Uint8Array>;
	model: ModelScan;
	warnings: string[];
}
interface ModelScan {
	app: string | null;
	objects: Map<string, { name: string | null }>;
	items: string[]; // objectid per build item, in order
	truncated: boolean;
}

function attrs(tag: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of tag.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
	return out;
}

/** Incremental scan of 3dmodel.model for objects, build items and the Application metadata, without keeping the (possibly huge) text. */
function makeModelScanner(scan: ModelScan, maxBytes: number) {
	const decoder = new TextDecoder();
	let tail = '';
	let seen = 0;
	const handle = (text: string) => {
		for (const m of text.matchAll(
			/<(object|item)\b[^>]*>|<metadata\b[^>]*name="Application"[^>]*>([^<]*)</g
		)) {
			if (m[2] !== undefined) {
				scan.app ??= decodeEntities(m[2]).trim() || null;
			} else if (m[1] === 'object') {
				const a = attrs(m[0]);
				if (a.id && a.type !== 'support' && a.type !== 'solidsupport')
					scan.objects.set(a.id, { name: a.name ? decodeEntities(a.name) : null });
			} else {
				const a = attrs(m[0]);
				if (a.objectid) scan.items.push(a.objectid);
			}
		}
	};
	return {
		/** Returns false once the byte budget is spent. */
		push(chunk: Uint8Array, final: boolean): boolean {
			seen += chunk.length;
			let buf = tail + decoder.decode(chunk, { stream: !final });
			tail = '';
			if (!final) {
				const lt = buf.lastIndexOf('<');
				if (lt >= 0) {
					const seg = buf.slice(lt);
					if (!seg.includes('>') || (/^<metadata\b/.test(seg) && !seg.includes('</metadata>'))) {
						tail = seg;
						buf = buf.slice(0, lt);
					}
				}
			}
			handle(buf);
			if (seen > maxBytes) {
				scan.truncated = true;
				return false;
			}
			return true;
		}
	};
}

async function readRaw(source: Source, limits: ParseLimits): Promise<Raw> {
	const raw: Raw = {
		configs: new Map(),
		thumbs: new Map(),
		model: { app: null, objects: new Map(), items: [], truncated: false },
		warnings: []
	};
	let entries = 0;
	let failure: Error | null = null;

	const uz = new Unzip((file) => {
		if (failure) return;
		if (++entries > limits.maxEntries) {
			failure = new ThreeMfError('The 3MF has too many entries');
			return;
		}
		const name = file.name;
		const isConfig = CONFIGS.has(name);
		const isThumb = THUMB_RE.test(name);
		const isModel = name === MODEL;
		if (!isConfig && !isThumb && !isModel) return; // never started, so never inflated
		const cap = isConfig ? limits.maxConfigBytes : limits.maxThumbBytes;
		const scanner = isModel ? makeModelScanner(raw.model, limits.maxModelBytes) : null;
		const chunks: Uint8Array[] = [];
		let size = 0;
		let dead = false;
		file.ondata = (err, chunk, final) => {
			if (dead) return;
			if (err) {
				failure ??= new ThreeMfError(`Cannot read ${name}: ${err.message}`);
				dead = true;
				return;
			}
			if (scanner) {
				if (!scanner.push(chunk, final)) {
					dead = true;
					file.terminate();
					raw.warnings.push(`${name} is very large; only its start was read`);
				}
				return;
			}
			size += chunk.length;
			if (size > cap) {
				dead = true;
				file.terminate();
				if (isConfig) failure ??= new ThreeMfError(`${name} is too large to read`);
				else raw.warnings.push(`Skipped oversized thumbnail ${name}`);
				return;
			}
			chunks.push(chunk);
			if (final) {
				const buf = new Uint8Array(size);
				let o = 0;
				for (const c of chunks) {
					buf.set(c, o);
					o += c.length;
				}
				(isConfig ? raw.configs : raw.thumbs).set(name, buf);
			}
		};
		file.start();
	});
	uz.register(UnzipInflate);
	uz.register(UnzipPassThrough);

	try {
		for await (const chunk of source as AsyncIterable<Uint8Array>) {
			uz.push(chunk);
			if (failure) break;
		}
		if (!failure) uz.push(new Uint8Array(0), true);
	} catch (e) {
		failure ??= new ThreeMfError(
			`This does not look like a valid 3MF (zip) file: ${(e as Error).message}`
		);
	}
	if (failure) throw failure;
	return raw;
}

const xml = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@',
	parseAttributeValue: false,
	parseTagValue: false,
	htmlEntities: true,
	isArray: (n) =>
		[
			'object',
			'part',
			'volume',
			'plate',
			'model_instance',
			'metadata',
			'filament',
			'header_item'
		].includes(n)
});

type XNode = Record<string, unknown>;
const asArr = <T>(v: T | T[] | undefined | null): T[] =>
	Array.isArray(v) ? v : v == null ? [] : [v];
function meta(node: unknown): Record<string, string> {
	const m: Record<string, string> = {};
	for (const e of asArr<XNode>((node as XNode)?.metadata as XNode[])) {
		const k = e['@key'];
		if (typeof k === 'string') m[k] = String(e['@value'] ?? '');
	}
	return m;
}
const num = (v: unknown): number | null => {
	if (v === undefined || v === null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

function parseXml(bytes: Uint8Array, what: string): XNode {
	try {
		return xml.parse(strFromU8(bytes)) as XNode;
	} catch (e) {
		throw new ThreeMfError(`Cannot parse ${what}: ${(e as Error).message}`);
	}
}

function normColor(c: unknown): string | null {
	if (typeof c !== 'string') return null;
	const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c.trim());
	return m ? `#${m[1].toUpperCase()}` : null;
}

function filamentName(settingsId: unknown): string | undefined {
	if (typeof settingsId !== 'string' || !settingsId) return undefined;
	return settingsId.split('@')[0].trim() || undefined;
}

/** Collapses objects with the same name and filament into one with a count. */
function mergeObjects(
	list: { id: string; name: string; filamentIndex: number | null }[]
): ThreeMfObject[] {
	const byKey = new Map<string, ThreeMfObject>();
	for (const o of list) {
		const key = `${o.name}\u0000${o.filamentIndex ?? ''}`;
		const cur = byKey.get(key);
		if (cur) cur.count += 1;
		else byKey.set(key, { id: o.id, name: o.name, filamentIndex: o.filamentIndex, count: 1 });
	}
	return [...byKey.values()];
}

function buildProject(raw: Raw): ThreeMfSummary {
	const get = (n: string) => raw.configs.get(n);
	let ps: Record<string, unknown> = {};
	try {
		ps = JSON.parse(strFromU8(get('Metadata/project_settings.config')!));
	} catch {
		raw.warnings.push(
			'project_settings.config could not be read; printer and filament details are missing'
		);
	}
	const ms = (parseXml(get('Metadata/model_settings.config')!, 'model_settings.config').config ??
		{}) as XNode;
	const sliceBytes = get('Metadata/slice_info.config');
	const si = (sliceBytes ? (parseXml(sliceBytes, 'slice_info.config').config ?? {}) : {}) as XNode;

	const types = asArr(ps.filament_type as string | string[]);
	const colours = asArr(ps.filament_colour as string | string[]);
	const ids = asArr(ps.filament_settings_id as string | string[]);
	const filaments: ThreeMfFilament[] = types.map((type, i) => ({
		index: i + 1,
		type: String(type),
		color: normColor(colours[i]),
		...(filamentName(ids[i]) ? { name: filamentName(ids[i]) } : {})
	}));

	const objects = new Map<string, { name: string; filamentIndex: number | null }>();
	for (const o of asArr<XNode>(ms.object as XNode[])) {
		const m = meta(o);
		const sub = asArr<XNode>((o.part ?? o.volume) as XNode[]);
		const firstPart = sub[0] ? meta(sub[0]) : {};
		objects.set(String(o['@id']), {
			name: decodeEntities(m.name || firstPart.name || `Object ${o['@id']}`),
			filamentIndex: num(m.extruder) ?? num(firstPart.extruder)
		});
	}

	const sliced = new Map<
		string,
		{ estSeconds: number | null; grams: number | null; fg: Record<string, number> }
	>();
	for (const p of asArr<XNode>(si.plate as XNode[])) {
		const m = meta(p);
		const fg: Record<string, number> = {};
		for (const f of asArr<XNode>(p.filament as XNode[])) {
			const g = num(f['@used_g']);
			if (f['@id'] !== undefined && g !== null && g > 0) fg[String(f['@id'])] = g;
		}
		const sum = Object.values(fg).reduce((a, b) => a + b, 0);
		sliced.set(String(m.index), {
			estSeconds: num(m.prediction),
			grams: num(m.weight) ?? (sum > 0 ? Math.round(sum * 100) / 100 : null),
			fg
		});
	}

	const plates: ThreeMfPlate[] = asArr<XNode>(ms.plate as XNode[])
		.map((p) => {
			const m = meta(p);
			const index = num(m.plater_id) ?? 0;
			const s = sliced.get(String(index));
			const list = asArr<XNode>(p.model_instance as XNode[]).flatMap((mi) => {
				const o = objects.get(meta(mi).object_id);
				return o ? [{ id: meta(mi).object_id, ...o }] : [];
			});
			const name = decodeEntities(m.plater_name || '').trim() || `Plate ${index}`;
			const base = (m.thumbnail_file || '').split('/').pop() || '';
			const thumb =
				raw.thumbs.get(`Metadata/${base}`) ??
				raw.thumbs.get(`Metadata/plate_${index}.png`) ??
				raw.thumbs.get(`Metadata/plate_${index}_small.png`);
			return {
				index,
				name,
				runsHint: runsHintFromName(name),
				estSeconds: s?.estSeconds && s.estSeconds > 0 ? Math.round(s.estSeconds) : null,
				grams: s?.grams ?? null,
				filamentGrams: s?.fg ?? {},
				...(thumb ? { thumbnail: thumb } : {}),
				objects: mergeObjects(list)
			};
		})
		.filter((p) => p.index > 0)
		.sort((a, b) => a.index - b.index);

	const printer =
		(typeof ps.printer_model === 'string' && ps.printer_model) ||
		(typeof ps.printer_settings_id === 'string' &&
			ps.printer_settings_id.replace(/\s*\d*\.?\d+\s*nozzle\s*$/i, '').trim()) ||
		null;
	return {
		app: raw.model.app,
		kind: 'project',
		sliced: plates.some((p) => p.estSeconds !== null || p.grams !== null),
		printer: printer || null,
		nozzle: num(asArr(ps.nozzle_diameter as string | string[])[0]),
		layerHeight: num(ps.layer_height),
		filaments,
		plates,
		warnings: raw.warnings
	};
}

function buildPlain(raw: Raw): ThreeMfSummary {
	const prusaNames = new Map<string, string>();
	const prusa = raw.configs.get('Metadata/Slic3r_PE_model.config');
	if (prusa) {
		for (const m of strFromU8(prusa).matchAll(
			/<object\b[^>]*\bid="([^"]+)"[^>]*>\s*<metadata\b[^>]*key="name"[^>]*value="([^"]*)"/g
		))
			prusaNames.set(m[1], decodeEntities(m[2]));
	}
	const m = raw.model;
	const ids = m.items.length ? m.items : [...m.objects.keys()];
	const list = ids.map((id) => ({
		id,
		name: prusaNames.get(id) ?? m.objects.get(id)?.name ?? `Object ${id}`,
		filamentIndex: null
	}));
	if (m.truncated)
		raw.warnings.push('Only the start of the model was scanned, so some objects may be missing');
	return {
		app: m.app,
		kind: 'plain',
		sliced: false,
		printer: null,
		nozzle: null,
		layerHeight: null,
		filaments: [],
		plates: list.length
			? [
					{
						index: 1,
						name: 'All objects',
						runsHint: 1,
						estSeconds: null,
						grams: null,
						filamentGrams: {},
						objects: mergeObjects(list)
					}
				]
			: [],
		warnings: raw.warnings
	};
}

/** Parses a 3MF from any chunk source (HTTP body, file stream, buffer). */
export async function parseThreeMf(
	source: Source,
	limits: Partial<ParseLimits> = {}
): Promise<ThreeMfSummary> {
	const raw = await readRaw(source, { ...DEFAULT_LIMITS, ...limits });
	const isProject =
		raw.configs.has('Metadata/model_settings.config') &&
		raw.configs.has('Metadata/project_settings.config');
	if (!isProject && !raw.model.objects.size && !raw.model.items.length)
		throw new ThreeMfError('No model found: this is not a 3MF slicer file');
	return isProject ? buildProject(raw) : buildPlain(raw);
}

export function parseThreeMfBytes(bytes: Uint8Array, limits?: Partial<ParseLimits>) {
	return parseThreeMf([bytes], limits);
}

export function parseThreeMfFile(path: string, limits?: Partial<ParseLimits>) {
	return parseThreeMf(createReadStream(path, { highWaterMark: 1 << 20 }), limits);
}
