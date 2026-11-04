/** Server-side client for Spoolman's REST API (`/api/v1`). Short timeouts, readable errors. */

export class SpoolmanError extends Error {
	constructor(
		message: string,
		public status = 502
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
}

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

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
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
		location: s(raw.location)
	};
}

export class SpoolmanClient {
	readonly base: string;
	constructor(
		url: string,
		private timeoutMs = 6000,
		private fetchImpl: typeof fetch = fetch
	) {
		this.base = normalizeSpoolmanUrl(url);
	}

	private async req(method: string, path: string, body?: unknown): Promise<unknown> {
		let res: Response;
		try {
			res = await this.fetchImpl(`${this.base}/api/v1${path}`, {
				method,
				headers:
					body === undefined
						? { accept: 'application/json' }
						: { 'content-type': 'application/json', accept: 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeoutMs)
			});
		} catch (e) {
			const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
			throw new SpoolmanError(
				timeout
					? 'Spoolman did not answer in time. Check the address and that it is running.'
					: 'Cannot reach Spoolman. Check the address and that it is running.'
			);
		}
		if (!res.ok) {
			let detail = '';
			try {
				const j = (await res.json()) as Obj;
				detail = typeof j.message === 'string' ? j.message : '';
			} catch {
				/* not json */
			}
			throw new SpoolmanError(
				res.status === 404
					? 'Spoolman answered 404. Is the address right (and is that a Spoolman server)?'
					: `Spoolman returned ${res.status}${detail ? `: ${detail}` : ''}`
			);
		}
		try {
			return await res.json();
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

	async getSpool(id: number): Promise<SpoolSummary> {
		const sp = toSpoolSummary(await this.req('GET', `/spool/${id}`));
		if (!sp) throw new SpoolmanError('Spoolman sent something unexpected.');
		return sp;
	}

	/** Consume `grams` from a spool: `PUT /spool/{id}/use`. */
	async useWeight(id: number, grams: number): Promise<void> {
		await this.req('PUT', `/spool/${id}/use`, { use_weight: grams });
	}

	/** Put grams back (undo): lowers `used_weight` with a PATCH, never below zero. */
	async restoreWeight(id: number, grams: number): Promise<void> {
		const sp = await this.getSpool(id);
		const used = Math.max(0, (sp.usedG ?? 0) - grams);
		await this.req('PATCH', `/spool/${id}`, { used_weight: Math.round(used * 10) / 10 });
	}
}
