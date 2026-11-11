/** Klipper via Moonraker: WebSocket JSON-RPC with `printer.objects.subscribe`. Read-only. */
import type { PrinterStatus } from '#lib/printers/status.ts';
import {
	backoff,
	num,
	safeError,
	StatusSubject,
	temp,
	type AdapterHandle,
	type PrinterConfig
} from '../types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Merge a (partial) status update into the accumulated object tree. */
export function mergeStatus(into: Obj, patch: Obj): Obj {
	for (const [k, v] of Object.entries(patch)) {
		// JSON.parse makes `__proto__` an own key: never merge into prototypes.
		if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
		if (isObj(v) && isObj(into[k])) mergeStatus(into[k] as Obj, v);
		else into[k] = isObj(v) ? mergeStatus({}, v) : v;
	}
	return into;
}

export function normalizeMoonraker(st: Obj): PrinterStatus {
	const ps = isObj(st.print_stats) ? st.print_stats : {};
	const ds = isObj(st.display_status) ? st.display_status : {};
	const vs = isObj(st.virtual_sdcard) ? st.virtual_sdcard : {};
	const ex = isObj(st.extruder) ? st.extruder : {};
	const hb = isObj(st.heater_bed) ? st.heater_bed : {};
	const info = isObj(ps.info) ? ps.info : {};
	const st0 = typeof ps.state === 'string' ? ps.state : 'standby';
	const state: PrinterStatus['state'] =
		st0 === 'printing'
			? 'printing'
			: st0 === 'paused'
				? 'paused'
				: st0 === 'complete'
					? 'done'
					: st0 === 'cancelled'
						? 'failed'
						: st0 === 'error'
							? 'error'
							: 'idle';
	let frac = num(ds.progress) ?? num(vs.progress);
	if (state === 'done') frac = 1;
	const elapsed = num(ps.print_duration);
	const out: PrinterStatus = {
		state,
		progress: state === 'idle' ? null : frac === undefined ? null : Math.round(frac * 1000) / 10,
		fileName:
			state !== 'idle' && typeof ps.filename === 'string' && ps.filename ? ps.filename : undefined,
		nozzleC: temp(ex.temperature),
		bedC: temp(hb.temperature)
	};
	if (state === 'printing' || state === 'paused' || state === 'done') {
		out.layer = num(info.current_layer);
		out.totalLayers = num(info.total_layer);
		out.elapsedSec = elapsed === undefined ? undefined : Math.round(elapsed);
		if (state !== 'done' && elapsed && frac && frac > 0.01)
			out.remainingSec = Math.max(0, Math.round(elapsed / frac - elapsed));
	}
	if (st0 === 'cancelled') out.cancelled = true;
	if (state === 'error')
		out.message = typeof ps.message === 'string' ? ps.message : 'Klipper error';
	return out;
}

export function connectMoonraker(cfg: PrinterConfig): AdapterHandle {
	const subj = new StatusSubject();
	let ws: WebSocket | null = null;
	let attempt = 0;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let ping: ReturnType<typeof setInterval> | undefined;
	let stale: ReturnType<typeof setTimeout> | undefined;
	let acc: Obj = {};
	const base = `${cfg.host}:${cfg.port ?? 7125}`;

	const armStale = () => {
		clearTimeout(stale);
		stale = setTimeout(
			() => subj.emit({ state: 'offline', progress: null, message: 'No data from the printer' }),
			45000
		);
	};
	const reconnect = () => {
		clearInterval(ping);
		clearTimeout(stale);
		if (subj.closed) return;
		subj.emit({ state: 'offline', progress: null, message: 'Disconnected' });
		clearTimeout(retry);
		retry = setTimeout(() => void open(), backoff(attempt++));
	};

	async function open() {
		if (subj.closed) return;
		let query = '';
		if (cfg.secrets.apiKey) {
			// Browsers/WebSocket cannot set headers: trade the API key for a one-shot token.
			try {
				const r = await fetch(`http://${base}/access/oneshot_token`, {
					headers: { 'X-Api-Key': cfg.secrets.apiKey },
					signal: AbortSignal.timeout(5000)
				});
				const j = (await r.json()) as { result?: string };
				if (j.result) query = `?token=${encodeURIComponent(j.result)}`;
			} catch (e) {
				subj.emit({ state: 'offline', progress: null, message: safeError(e) });
				retry = setTimeout(() => void open(), backoff(attempt++));
				return;
			}
			if (subj.closed) return;
		}
		let sock: WebSocket;
		try {
			sock = new WebSocket(`ws://${base}/websocket${query}`);
		} catch (e) {
			subj.emit({ state: 'offline', progress: null, message: safeError(e) });
			retry = setTimeout(() => void open(), backoff(attempt++));
			return;
		}
		ws = sock;
		sock.onopen = () => {
			attempt = 0;
			acc = {};
			armStale();
			sock.send(
				JSON.stringify({
					jsonrpc: '2.0',
					method: 'printer.objects.subscribe',
					params: {
						objects: {
							print_stats: null,
							display_status: null,
							virtual_sdcard: null,
							extruder: ['temperature', 'target'],
							heater_bed: ['temperature', 'target']
						}
					},
					id: 1
				})
			);
			clearInterval(ping);
			ping = setInterval(() => {
				if (sock.readyState === 1)
					sock.send(JSON.stringify({ jsonrpc: '2.0', method: 'server.info', id: 2 }));
			}, 15000);
		};
		sock.onmessage = (ev) => {
			try {
				let m: unknown;
				try {
					m = JSON.parse(String(ev.data));
				} catch {
					return;
				}
				if (!isObj(m)) return;
				armStale();
				if (m.id === 1 && isObj(m.result) && isObj(m.result.status)) {
					acc = mergeStatus({}, m.result.status);
					subj.emit(normalizeMoonraker(acc));
				} else if (
					m.method === 'notify_status_update' &&
					Array.isArray(m.params) &&
					isObj(m.params[0])
				) {
					mergeStatus(acc, m.params[0]);
					subj.emit(normalizeMoonraker(acc));
				} else if (m.id === 2 && subj.current?.state === 'offline') {
					subj.emit(normalizeMoonraker(acc));
				}
			} catch {
				/* a malformed or hostile frame is ignored (nothing from it is logged) */
			}
		};
		sock.onerror = () => {};
		sock.onclose = () => {
			if (ws === sock) reconnect();
		};
	}
	void open();

	return {
		status$: (cb) => subj.subscribe(cb),
		close: () => {
			subj.closed = true;
			clearInterval(ping);
			clearTimeout(retry);
			clearTimeout(stale);
			const s = ws;
			ws = null;
			try {
				s?.close();
			} catch {
				/* ignore */
			}
		}
	};
}
