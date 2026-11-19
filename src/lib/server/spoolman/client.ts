import { isObj } from '#lib/domain/guards.ts';
/**
 * Server-side client for Spoolman's REST API (`/api/v1`). Short timeouts, readable errors.
 * Every request goes through the outbound guard (`printers/outbound.ts`): refused in public mode,
 * only to local addresses otherwise, never follows a redirect, never repeats what Spoolman says.
 */
import {
	assertOutboundAllowed,
	guardedFetch,
	isRedirect,
	OutboundError,
	readJsonCapped,
	REDIRECT_MESSAGE
} from '../printers/outbound';

export class SpoolmanError extends Error {
	constructor(
		message: string,
		public status = 502,
		/** What Spoolman itself answered (never its text), when it answered. */
		public remoteStatus: number | null = null
	) {
		super(message);
	}
}

export interface SpoolSummary {
	id: number;
	name: string;
	vendor: string | null;
	material: string | null;
	colorHex: string | null;
	remainingG: number | null;
	usedG: number | null;
	initialG: number | null;
	archived: boolean;
	location: string | null;
	/** The Spoolman filament this spool belongs to (null when the record had none). */
	filamentId: number | null;
}

/** A Spoolman filament record, reduced to the fields the app reads. */
export interface SpoolmanFilament {
	id: number;
	name: string;
	vendor: string | null;
	material: string | null;
	colorHex: string | null;
	density: number | null;
	diameter: number | null;
	/** Net filament weight of a new spool (g). */
	weightG: number | null;
	/** Empty spool weight (g). */
	spoolWeightG: number | null;
	/** SpoolmanDB id when the filament was imported from it. */
	externalId: string | null;
}

export interface SpoolmanSpoolStock {
	id: number;
	remainingG: number | null;
	initialG: number | null;
	usedG: number | null;
	archived: boolean;
	location: string | null;
}

export interface FilamentWithSpools extends SpoolmanFilament {
	spools: SpoolmanSpoolStock[];
}

const MAX_LIST = 5000;

/** Accepts "host:7912", "http://host:7912/" or a URL ending in /api/v1. Returns the origin + path prefix. */
export function normalizeSpoolmanUrl(raw: string): string {
	let s = raw.trim();
	if (!s) throw new SpoolmanError('Enter the Spoolman address', 400);
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s))
		throw new SpoolmanError('The address must start with http:// or https://', 400);
	if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
	let u: URL;
	try {
		u = new URL(s);
	} catch {
		throw new SpoolmanError('That is not a valid address', 400);
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:')
		throw new SpoolmanError('The address must start with http:// or https://', 400);
	const path = u.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
	return `${u.origin}${path}`;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v: unknown) => (typeof v === 'string' && v ? v : null);

export function toSpoolSummary(raw: unknown): SpoolSummary | null {
	if (!isObj(raw) || typeof raw.id !== 'number') return null;
	const f = isObj(raw.filament) ? raw.filament : {};
	const vendor = isObj(f.vendor) ? s(f.vendor.name) : null;
	const hex = s(f.color_hex);
	return {
		id: raw.id,
		name: s(f.name) ?? `Spool ${raw.id}`,
		vendor,
		material: s(f.material),
		colorHex: hex ? `#${hex.replace(/^#/, '').slice(0, 6).toLowerCase()}` : null,
		remainingG: n(raw.remaining_weight),
		usedG: n(raw.used_weight),
		initialG: n(raw.initial_weight),
		archived: raw.archived === true,
		location: s(raw.location),
		filamentId: typeof f.id === 'number' && Number.isInteger(f.id) && f.id > 0 ? f.id : null
	};
}

const text = (v: unknown, max = 200): string | null =>
	typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const hexOf = (v: unknown): string | null => {
	const h = typeof v === 'string' ? v.trim().replace(/^#/, '') : '';
	return /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h) ? `#${h.slice(0, 6).toLowerCase()}` : null;
};

/** Validate one Spoolman filament record; null when it has no usable id. */
export function parseFilament(raw: unknown): SpoolmanFilament | null {
	if (!isObj(raw) || typeof raw.id !== 'number' || !Number.isInteger(raw.id) || raw.id < 1)
		return null;
	const pos = (v: unknown) => {
		const x = n(v);
		return x !== null && x > 0 ? x : null;
	};
	return {
		id: raw.id,
		name: text(raw.name) ?? `Filament ${raw.id}`,
		vendor: isObj(raw.vendor) ? text(raw.vendor.name) : null,
		material: text(raw.material, 60),
		colorHex: hexOf(raw.color_hex),
		density: pos(raw.density),
		diameter: pos(raw.diameter),
		weightG: pos(raw.weight),
		spoolWeightG: pos(raw.spool_weight),
		externalId: text(raw.external_id, 120)
	};
}

/** Validate one spool record into its stock numbers; null when it has no usable id. */
export function parseSpoolStock(raw: unknown): SpoolmanSpoolStock | null {
	if (!isObj(raw) || typeof raw.id !== 'number' || !Number.isInteger(raw.id) || raw.id < 1)
		return null;
	return {
		id: raw.id,
		remainingG: n(raw.remaining_weight),
		initialG: n(raw.initial_weight),
		usedG: n(raw.used_weight),
		archived: raw.archived === true,
		location: text(raw.location)
	};
}

/** What `spoolman_cache.data` holds: the filament in Spoolman's own field names plus its spools. */
export function toCacheData(f: FilamentWithSpools): Record<string, unknown> {
	return {
		id: f.id,
		name: f.name,
		material: f.material ?? undefined,
		color_hex: f.colorHex ? f.colorHex.slice(1) : undefined,
		vendor: f.vendor ? { name: f.vendor } : null,
		weight: f.weightG,
		spool_weight: f.spoolWeightG,
		density: f.density,
		diameter: f.diameter,
		external_id: f.externalId ?? undefined,
		spools: f.spools.map((x) => ({
			id: x.id,
			remaining_weight: x.remainingG,
			initial_weight: x.initialG,
			used_weight: x.usedG,
			archived: x.archived
		}))
	};
}

/** Read a cache row back (never throws; null when it has no usable filament). */
export function fromCacheData(data: unknown): FilamentWithSpools | null {
	const f = parseFilament(data);
	if (!f || !isObj(data)) return null;
	const spools = Array.isArray(data.spools)
		? data.spools.map(parseSpoolStock).filter((x): x is SpoolmanSpoolStock => !!x)
		: [];
	return { ...f, spools };
}

export interface SpoolmanVendor {
	id: number;
	name: string;
}

/** Fields the app sends when it creates a filament in Spoolman (already validated by the caller). */
export interface NewSpoolmanFilament {
	name: string;
	vendorId: number;
	material: string;
	/** `#rrggbb` */
	colorHex: string;
	density: number;
	diameter: number;
	weightG: number;
	spoolWeightG: number | null;
	externalId?: string | null;
}

/** Fields the app sends when it creates a spool in Spoolman. */
export interface NewSpoolmanSpool {
	filamentId: number;
	/** Net filament weight on the new spool (g). */
	initialG: number;
	/** Empty spool weight (g); omitted = the filament's. */
	spoolWeightG?: number | null;
	comment?: string | null;
}

export function parseVendor(raw: unknown): SpoolmanVendor | null {
	if (!isObj(raw) || typeof raw.id !== 'number' || !Number.isInteger(raw.id) || raw.id < 1)
		return null;
	const name = text(raw.name);
	return name ? { id: raw.id, name } : null;
}

export class SpoolmanClient {
	readonly base: string;
	constructor(
		url: string,
		private timeoutMs = 6000,
		private fetchImpl: typeof fetch = guardedFetch
	) {
		this.base = normalizeSpoolmanUrl(url);
	}

	private async req(method: string, path: string, body?: unknown): Promise<unknown> {
		try {
			assertOutboundAllowed(); // public mode: nothing is sent, nothing is looked up
		} catch (e) {
			if (e instanceof OutboundError) throw new SpoolmanError(e.message, e.status);
			throw e;
		}
		let res: Response;
		try {
			res = await this.fetchImpl(`${this.base}/api/v1${path}`, {
				method,
				headers:
					body === undefined
						? { accept: 'application/json' }
						: { 'content-type': 'application/json', accept: 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
				redirect: 'manual',
				signal: AbortSignal.timeout(this.timeoutMs)
			});
		} catch (e) {
			if (e instanceof OutboundError) throw new SpoolmanError(e.message, e.status);
			const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
			throw new SpoolmanError(
				timeout
					? 'Spoolman did not answer in time. Check the address and that it is running.'
					: 'Cannot reach Spoolman. Check the address and that it is running.'
			);
		}
		if (isRedirect(res.status)) {
			await res.body?.cancel().catch(() => {});
			throw new SpoolmanError(REDIRECT_MESSAGE);
		}
		if (!res.ok) {
			await res.body?.cancel().catch(() => {}); // what Spoolman says is never passed on
			throw new SpoolmanError(
				res.status === 404
					? 'Spoolman answered 404. Is the address right (and is that a Spoolman server)?'
					: res.status === 401 || res.status === 403
						? 'Spoolman refused the request (it may need a different address or login).'
						: `Spoolman returned ${res.status}`,
				502,
				res.status
			);
		}
		try {
			return await readJsonCapped(res, 4 * 1024 * 1024);
		} catch {
			throw new SpoolmanError('Spoolman sent something unexpected. Is that a Spoolman address?');
		}
	}

	async health(): Promise<{ version: string | null }> {
		const j = await this.req('GET', '/info');
		return { version: isObj(j) ? s(j.version) : null };
	}

	async listSpools(): Promise<SpoolSummary[]> {
		const j = await this.req('GET', '/spool?allow_archived=false');
		if (!Array.isArray(j)) throw new SpoolmanError('Spoolman sent something unexpected.');
		return j.map(toSpoolSummary).filter((x): x is SpoolSummary => !!x);
	}

	async listFilaments(): Promise<SpoolmanFilament[]> {
		const j = await this.req('GET', '/filament');
		if (!Array.isArray(j) || j.length > MAX_LIST)
			throw new SpoolmanError('Spoolman sent something unexpected.');
		return j.map(parseFilament).filter((x): x is SpoolmanFilament => !!x);
	}

	async getFilament(id: number): Promise<SpoolmanFilament> {
		const f = parseFilament(await this.req('GET', `/filament/${id}`));
		if (!f || f.id !== id) throw new SpoolmanError('Spoolman sent something unexpected.');
		return f;
	}

	/** Every spool (archived too) grouped by its filament, as the stock numbers the app reads. */
	private async spoolStocks(filamentId?: number): Promise<Map<number, SpoolmanSpoolStock[]>> {
		const q = filamentId != null ? `&filament_id=${filamentId}` : '';
		const j = await this.req('GET', `/spool?allow_archived=true${q}`);
		if (!Array.isArray(j) || j.length > MAX_LIST)
			throw new SpoolmanError('Spoolman sent something unexpected.');
		const out = new Map<number, SpoolmanSpoolStock[]>();
		for (const raw of j) {
			const sp = toSpoolSummary(raw);
			const st = parseSpoolStock(raw);
			if (!sp || !st || sp.filamentId == null) continue;
			if (filamentId != null && sp.filamentId !== filamentId) continue;
			const list = out.get(sp.filamentId) ?? [];
			list.push(st);
			out.set(sp.filamentId, list);
		}
		return out;
	}

	/** All filaments with their spools (two requests). */
	async listFilamentsWithSpools(): Promise<FilamentWithSpools[]> {
		const [filaments, stocks] = await Promise.all([this.listFilaments(), this.spoolStocks()]);
		return filaments.map((f) => ({ ...f, spools: stocks.get(f.id) ?? [] }));
	}

	/** One filament with its spools. */
	async getFilamentWithSpools(id: number): Promise<FilamentWithSpools> {
		const f = await this.getFilament(id);
		const stocks = await this.spoolStocks(id);
		return { ...f, spools: stocks.get(id) ?? [] };
	}

	async getSpool(id: number): Promise<SpoolSummary> {
		const sp = toSpoolSummary(await this.req('GET', `/spool/${id}`));
		if (!sp) throw new SpoolmanError('Spoolman sent something unexpected.');
		return sp;
	}

	/** Consume `grams` from a spool: `PUT /spool/{id}/use`. */
	async useWeight(id: number, grams: number): Promise<SpoolSummary | null> {
		return toSpoolSummary(await this.req('PUT', `/spool/${id}/use`, { use_weight: grams }));
	}

	/** Put grams back (undo): lowers `used_weight` with a PATCH, never below zero. */
	async restoreWeight(id: number, grams: number): Promise<void> {
		const sp = await this.getSpool(id);
		const used = Math.max(0, (sp.usedG ?? 0) - grams);
		await this.req('PATCH', `/spool/${id}`, { used_weight: Math.round(used * 10) / 10 });
	}

	async listVendors(): Promise<SpoolmanVendor[]> {
		const j = await this.req('GET', '/vendor');
		if (!Array.isArray(j) || j.length > MAX_LIST)
			throw new SpoolmanError('Spoolman sent something unexpected.');
		return j.map(parseVendor).filter((x): x is SpoolmanVendor => !!x);
	}

	async createVendor(name: string): Promise<SpoolmanVendor> {
		const v = parseVendor(await this.req('POST', '/vendor', { name }));
		if (!v) throw new SpoolmanError('Spoolman sent something unexpected.');
		return v;
	}

	/** `POST /filament`; the answer must be the record that was asked for. */
	async createFilament(f: NewSpoolmanFilament): Promise<SpoolmanFilament> {
		const made = parseFilament(
			await this.req('POST', '/filament', {
				name: f.name,
				vendor_id: f.vendorId,
				material: f.material,
				color_hex: f.colorHex.replace(/^#/, ''),
				density: f.density,
				diameter: f.diameter,
				weight: f.weightG,
				...(f.spoolWeightG != null && f.spoolWeightG > 0 ? { spool_weight: f.spoolWeightG } : {}),
				...(f.externalId ? { external_id: f.externalId } : {})
			})
		);
		if (!made) throw new SpoolmanError('Spoolman sent something unexpected.');
		return made;
	}

	/** `POST /spool`; returns the new spool's stock numbers and filament. */
	async createSpool(
		sp: NewSpoolmanSpool
	): Promise<{ stock: SpoolmanSpoolStock; filamentId: number | null }> {
		const raw = await this.req('POST', '/spool', {
			filament_id: sp.filamentId,
			initial_weight: sp.initialG,
			...(sp.spoolWeightG != null && sp.spoolWeightG > 0 ? { spool_weight: sp.spoolWeightG } : {}),
			...(sp.comment ? { comment: sp.comment } : {})
		});
		const stock = parseSpoolStock(raw);
		const summary = toSpoolSummary(raw);
		if (!stock || !summary) throw new SpoolmanError('Spoolman sent something unexpected.');
		return { stock, filamentId: summary.filamentId };
	}

	/** Archive (or restore) a spool: `PATCH /spool/{id}` with `archived`. Its weight and history stay. */
	async setArchived(id: number, archived: boolean): Promise<void> {
		const sp = parseSpoolStock(await this.req('PATCH', `/spool/${id}`, { archived }));
		if (!sp || sp.id !== id) throw new SpoolmanError('Spoolman sent something unexpected.');
	}
}
