/**
 * A fake Spoolman server for unit and e2e tests (issue #59). It speaks the parts of the REST API
 * the app uses (`/api/v1/info`, `/filament`, `/spool`, `PUT /spool/{id}/use`, `PATCH /spool/{id}`,
 * and the creates the later stages need) over plain http on a loopback port, keeps its data in
 * memory and records every request in `calls`. Never talks to anything outside the process.
 *
 * Used from vitest (import it) and from Playwright specs (`startMockSpoolman()` in a spec file,
 * pass `mock.url` as the workspace's Spoolman address).
 */
import { createServer, type Server } from 'node:http';

export interface MockFilament {
	id: number;
	name: string;
	vendor: { id: number; name: string };
	material: string;
	color_hex: string;
	density: number;
	diameter: number;
	weight: number;
	spool_weight: number;
	external_id?: string;
}

export interface MockSpool {
	id: number;
	filament_id: number;
	initial_weight: number;
	used_weight: number;
	archived: boolean;
	location?: string;
	comment?: string;
	spool_weight?: number;
}

export interface MockSpoolman {
	/** Base address to save as the workspace's Spoolman address. */
	url: string;
	filaments: Map<number, MockFilament>;
	vendors: Map<number, { id: number; name: string }>;
	spools: Map<number, MockSpool>;
	/** Every request as `METHOD path body`. */
	calls: string[];
	/** Answer every request with 500 while true. */
	failing: boolean;
	/** Wait this long before answering a `/use` call (to provoke races). */
	useDelayMs: number;
	addFilament(f: Partial<MockFilament> & { name: string }): MockFilament;
	addVendor(name: string, id?: number): { id: number; name: string };
	addSpool(s: Partial<MockSpool> & { filament_id: number }): MockSpool;
	/** Grams left on a spool (initial minus used). */
	remaining(id: number): number;
	reset(): void;
	close(): Promise<void>;
}

const json = (v: unknown) => JSON.stringify(v);

export async function startMockSpoolman(): Promise<MockSpoolman> {
	let nextFilament = 1;
	let nextSpool = 1;
	let nextVendor = 1;
	const m: MockSpoolman = {
		url: '',
		filaments: new Map(),
		vendors: new Map(),
		spools: new Map(),
		calls: [],
		failing: false,
		useDelayMs: 0,
		addVendor(name, id) {
			const have = [...m.vendors.values()].find((v) => v.name === name);
			if (have && id == null) return have;
			const vid = id ?? nextVendor++;
			nextVendor = Math.max(nextVendor, vid + 1);
			const v = { id: vid, name };
			m.vendors.set(vid, v);
			return v;
		},
		addFilament(f) {
			const id = f.id ?? nextFilament++;
			nextFilament = Math.max(nextFilament, id + 1);
			const rec: MockFilament = {
				id,
				vendor: f.vendor ?? m.addVendor('Acme'),
				material: 'PETG',
				color_hex: '2B3F9E',
				density: 1.27,
				diameter: 1.75,
				weight: 1000,
				spool_weight: 200,
				...f
			};
			m.addVendor(rec.vendor.name, rec.vendor.id);
			m.filaments.set(id, rec);
			return rec;
		},
		addSpool(s) {
			const id = s.id ?? nextSpool++;
			nextSpool = Math.max(nextSpool, id + 1);
			const rec: MockSpool = { id, initial_weight: 1000, used_weight: 0, archived: false, ...s };
			m.spools.set(id, rec);
			return rec;
		},
		remaining: (id) => {
			const s = m.spools.get(id);
			return s ? s.initial_weight - s.used_weight : NaN;
		},
		reset() {
			m.filaments.clear();
			m.vendors.clear();
			m.spools.clear();
			m.calls.length = 0;
			m.failing = false;
			m.useDelayMs = 0;
			nextFilament = nextSpool = nextVendor = 1;
		},
		close: () => new Promise((r) => srv.close(() => r()))
	};
	const spoolJson = (s: MockSpool) => ({
		id: s.id,
		archived: s.archived,
		location: s.location,
		comment: s.comment,
		spool_weight: s.spool_weight,
		initial_weight: s.initial_weight,
		used_weight: s.used_weight,
		remaining_weight: s.initial_weight - s.used_weight,
		filament: m.filaments.get(s.filament_id)
	});

	const srv: Server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', async () => {
			const path = req.url ?? '';
			m.calls.push(`${req.method} ${path}${body ? ` ${body}` : ''}`);
			res.setHeader('content-type', 'application/json');
			const send = (code: number, v: unknown) => res.writeHead(code).end(json(v));
			if (m.failing) return send(500, { message: 'boom' });
			const u = new URL(path, 'http://x');
			const p = u.pathname;
			let data: Record<string, unknown>;
			try {
				data = body ? JSON.parse(body) : {};
			} catch {
				return send(400, {});
			}
			if (p === '/api/v1/info') return send(200, { version: '0.22.1' });

			if (p === '/api/v1/filament' && req.method === 'GET')
				return send(200, [...m.filaments.values()]);
			const fm = /^\/api\/v1\/filament\/(\d+)$/.exec(p);
			if (fm && req.method === 'GET') {
				const f = m.filaments.get(Number(fm[1]));
				return f ? send(200, f) : send(404, {});
			}
			if (p === '/api/v1/filament' && req.method === 'POST') {
				// Like Spoolman: name and a known vendor are required; density/diameter must be positive.
				const d = data as Record<string, unknown>;
				const vendor = m.vendors.get(Number(d.vendor_id));
				if (typeof d.name !== 'string' || !d.name || !vendor) return send(422, {});
				if (!(Number(d.density) > 0) || !(Number(d.diameter) > 0)) return send(422, {});
				return send(
					200,
					m.addFilament({
						name: d.name,
						vendor,
						material: typeof d.material === 'string' ? d.material : undefined,
						color_hex: typeof d.color_hex === 'string' ? d.color_hex : undefined,
						density: Number(d.density),
						diameter: Number(d.diameter),
						weight: Number(d.weight) || undefined,
						spool_weight: Number(d.spool_weight) || undefined,
						external_id: typeof d.external_id === 'string' ? d.external_id : undefined
					})
				);
			}
			if (p === '/api/v1/vendor' && req.method === 'GET') return send(200, [...m.vendors.values()]);
			if (p === '/api/v1/vendor' && req.method === 'POST') {
				if (typeof data.name !== 'string' || !data.name) return send(422, {});
				return send(200, m.addVendor(data.name, nextVendor));
			}

			if (p === '/api/v1/spool' && req.method === 'GET') {
				const archived = u.searchParams.get('allow_archived') === 'true';
				const fid = u.searchParams.get('filament_id');
				return send(
					200,
					[...m.spools.values()]
						.filter((s) => (archived || !s.archived) && (!fid || String(s.filament_id) === fid))
						.map(spoolJson)
				);
			}
			if (p === '/api/v1/spool' && req.method === 'POST') {
				const d = data as {
					filament_id: number;
					initial_weight?: number;
					spool_weight?: number;
					comment?: string;
				};
				return m.filaments.has(d.filament_id) ? send(200, spoolJson(m.addSpool(d))) : send(400, {});
			}
			const sm = /^\/api\/v1\/spool\/(\d+)(\/use)?$/.exec(p);
			if (sm) {
				const s = m.spools.get(Number(sm[1]));
				if (!s) return send(404, {});
				if (sm[2] && req.method === 'PUT') {
					if (m.useDelayMs) await new Promise((r) => setTimeout(r, m.useDelayMs));
					s.used_weight += Number(data.use_weight) || 0;
				} else if (req.method === 'PATCH') {
					if (typeof data.used_weight === 'number') s.used_weight = data.used_weight;
					if (typeof data.archived === 'boolean') s.archived = data.archived;
				}
				return send(200, spoolJson(s));
			}
			send(404, {});
		});
	});
	await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
	m.url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
	return m;
}
