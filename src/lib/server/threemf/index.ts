/**
 * Streaming 3MF reader for slicer project files (Milestone 5).
 *
 * Supports Bambu Studio and the OrcaSlicer family (Elegoo Slicer, ...) project
 * files, which share the `Metadata/` layout (`model_settings.config`,
 * `slice_info.config` when sliced, `project_settings.config` JSON, `plate_N.png`
 * thumbnails), and plain 3MF files (objects only, read from `3D/3dmodel.model`).
 *
 * Files on disk are read through their central directory (`zipfile.ts`): only the wanted
 * entries are ever read or inflated (neither `3D/Objects/*` geometry nor the `plate_N.gcode`
 * of a sliced project, which can be hundreds of MB), each with a size cap, in flat memory.
 * Other sources (HTTP bodies, buffers) are streamed with fflate's `Unzip`, which buffers
 * unwanted entries that use data descriptors, so keep big inputs on disk.
 */
import { createReadStream } from 'node:fs';
import { Unzip, UnzipInflate, UnzipPassThrough, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { entryChunks, readZipDirectory } from './zipfile';
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

type EntrySink = (err: Error | null, chunk: Uint8Array, final: boolean) => 'stop' | undefined;

function newRaw(): Raw {
	return {
		configs: new Map(),
		thumbs: new Map(),
		model: { app: null, objects: new Map(), items: [], truncated: false },
		warnings: []
	};
}

/** The reader for one zip entry, or null when the entry is not wanted (then it is never inflated). */
function entrySink(
	name: string,
	raw: Raw,
	limits: ParseLimits,
	fail: (e: Error) => void
): EntrySink | null {
	const isConfig = CONFIGS.has(name);
	const isThumb = THUMB_RE.test(name);
	const isModel = name === MODEL;
	if (!isConfig && !isThumb && !isModel) return null;
	const cap = isConfig ? limits.maxConfigBytes : limits.maxThumbBytes;
	const scanner = isModel ? makeModelScanner(raw.model, limits.maxModelBytes) : null;
	const chunks: Uint8Array[] = [];
	let size = 0;
	let dead = false;
	return (err, chunk, final) => {
		if (dead) return undefined;
		if (err) {
			fail(new ThreeMfError(`Cannot read ${name}: ${err.message}`));
			dead = true;
			return 'stop';
		}
		if (scanner) {
			if (!scanner.push(chunk, final)) {
				dead = true;
				raw.warnings.push(`${name} is very large; only its start was read`);
				return 'stop';
			}
			return undefined;
		}
		size += chunk.length;
		if (size > cap) {
			dead = true;
			if (isConfig) fail(new ThreeMfError(`${name} is too large to read`));
			else raw.warnings.push(`Skipped oversized thumbnail ${name}`);
			return 'stop';
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
		return undefined;
	};
}

async function readRaw(source: Source, limits: ParseLimits): Promise<Raw> {
	const raw = newRaw();
	let entries = 0;
	let failure: Error | null = null;
	const fail = (e: Error) => {
		failure ??= e;
	};

	const uz = new Unzip((file) => {
		if (failure) return;
		if (++entries > limits.maxEntries) {
			fail(new ThreeMfError('The 3MF has too many entries'));
			return;
		}
		const sink = entrySink(file.name, raw, limits, fail);
		if (!sink) return; // never started, so never inflated
		file.ondata = (err, chunk, final) => {
			if (sink(err, chunk, final) === 'stop') file.terminate();
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

/**
 * Same result from a file on disk through its central directory: only the wanted entries are
 * read, so G-code, meshes and the size of the file cost nothing (see `zipfile.ts`).
 * Returns null when the directory cannot be read (the caller falls back to streaming).
 */
async function readRawFromFile(path: string, limits: ParseLimits): Promise<Raw | null> {
	let dir;
	try {
		dir = await readZipDirectory(path);
	} catch {
		return null;
	}
	if (dir.length > limits.maxEntries) throw new ThreeMfError('The 3MF has too many entries');
	const raw = newRaw();
	let failure: Error | null = null;
	for (const e of dir) {
		const sink = entrySink(e.name, raw, limits, (f) => (failure ??= f));
		if (!sink) continue;
		try {
			let any = false;
			for await (const chunk of entryChunks(path, e)) {
				any = true;
				if (sink(null, chunk, false) === 'stop') break;
			}
			// the sinks need a final marker; an empty last chunk closes the entry
			if (any || e.csize === 0) sink(null, new Uint8Array(0), true);
		} catch (err) {
			failure ??= new ThreeMfError(`Cannot read ${e.name}: ${(err as Error).message}`);
		}
		if (failure) throw failure;
	}
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
		{
			estSeconds: number | null;
			grams: number | null;
			fg: Record<string, number>;
			objects: { id: string; name: string; filamentIndex: number | null }[];
		}
	>();
	for (const p of asArr<XNode>(si.plate as XNode[])) {
		const m = meta(p);
		const fg: Record<string, number> = {};
		for (const f of asArr<XNode>(p.filament as XNode[])) {
			const g = num(f['@used_g']);
			if (f['@id'] !== undefined && g !== null && g > 0) fg[String(f['@id'])] = g;
		}
		const sum = Object.values(fg).reduce((a, b) => a + b, 0);
		// Elegoo/Orca 2.4 sliced exports leave the plates in model_settings.config without model
		// instances; the objects are then only listed here (`identify_id`, name with an `_id_N_copy_N` tail).
		const objects = asArr<XNode>(p.object as XNode[])
			.filter((o) => o['@skipped'] !== 'true')
			.map((o) => ({
				id: String(o['@identify_id'] ?? o['@id'] ?? o['@name']),
				name: decodeEntities(String(o['@name'] ?? ''))
					.replace(/_id_\d+_copy_\d+$/i, '')
					.trim(),
				filamentIndex: null
			}))
			.filter((o) => o.name);
		sliced.set(String(m.index), {
			estSeconds: num(m.prediction),
			grams: num(m.weight) ?? (sum > 0 ? Math.round(sum * 100) / 100 : null),
			fg,
			objects
		});
	}

	const plates: ThreeMfPlate[] = asArr<XNode>(ms.plate as XNode[])
		.map((p) => {
			const m = meta(p);
			const index = num(m.plater_id) ?? 0;
			const s = sliced.get(String(index));
			let list: { id: string; name: string; filamentIndex: number | null }[] = asArr<XNode>(
				p.model_instance as XNode[]
			).flatMap((mi) => {
				const o = objects.get(meta(mi).object_id);
				return o ? [{ id: meta(mi).object_id, ...o }] : [];
			});
			if (!list.length && s?.objects.length) list = s.objects;
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
	limits: Partial<ParseLimits> = {},
	prepared?: Raw
): Promise<ThreeMfSummary> {
	const raw = prepared ?? (await readRaw(source, { ...DEFAULT_LIMITS, ...limits }));
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

export async function parseThreeMfFile(path: string, limits?: Partial<ParseLimits>) {
	const all = { ...DEFAULT_LIMITS, ...limits };
	const raw = await readRawFromFile(path, all);
	if (raw) return parseThreeMf([], all, raw);
	return parseThreeMf(createReadStream(path, { highWaterMark: 1 << 20 }), limits);
}
