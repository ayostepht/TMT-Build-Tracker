import { isObj, type Obj } from '#lib/domain/guards.ts';
/** Klipper via Moonraker: WebSocket JSON-RPC with `printer.objects.subscribe`. Read-only. */
import type { PrinterStatus } from '#lib/printers/status.ts';
import {
	guardedFetch,
	ipForUrl,
	isRedirect,
	MAX_REMOTE_MESSAGE_BYTES,
	OutboundError,
	readJsonCapped,
	REDIRECT_MESSAGE,
	resolveAllowed,
	safeFileName,
	safeText
} from '../outbound';
import {
	backoff,
	HostileGuard,
	num,
	OVERSIZED_MESSAGE,
	safeError,
	StatusSubject,
	temp,
	type AdapterHandle,
	type PrinterConfig
} from '../types';

/** Merge a (partial) status update into the accumulated object tree. */
export function mergeStatus(into: Obj, patch: Obj): Obj {
	for (const [k, v] of Object.entries(patch)) {
		// A JSON `__proto__` key would otherwise merge into Object.prototype.
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
		fileName: state !== 'idle' ? safeFileName(ps.filename) : undefined,
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
	if (state === 'error') out.message = safeText(ps.message, 200) || 'Klipper error';
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
	const hostile = new HostileGuard();

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
		let base: string;
		let named: string;
		try {
			// Resolved and validated on every (re)connect; both requests go to the validated IP.
			const t = await resolveAllowed(cfg.host);
			base = `${ipForUrl(t.ip)}:${cfg.port ?? 7125}`;
			named = `${ipForUrl(t.host)}:${cfg.port ?? 7125}`; // keeps the Host header; guardedFetch pins the IP
		} catch (e) {
			if (subj.closed) return;
			subj.emit({ state: 'error', progress: null, message: safeError(e) });
			if (!(e instanceof OutboundError && e.kind === 'public'))
				retry = setTimeout(() => void open(), backoff(attempt++ + 3));
			return;
		}
		if (subj.closed) return;
		let query = '';
		if (cfg.secrets.apiKey) {
			// Browsers/WebSocket cannot set headers: trade the API key for a one-shot token.
			try {
				const r = await guardedFetch(`http://${named}/access/oneshot_token`, {
					headers: { 'X-Api-Key': cfg.secrets.apiKey },
					signal: AbortSignal.timeout(5000)
				});
				if (isRedirect(r.status)) throw new Error(REDIRECT_MESSAGE);
				const j = (await readJsonCapped(r)) as { result?: string };
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
		/** Oversized or non-text frame: drop the socket and come back on a long backoff. */
		const tooBig = () => {
			ws = null; // the close handler below then ignores this socket
			sock.onmessage = null;
			clearInterval(ping);
			clearTimeout(stale);
			try {
				sock.close();
			} catch {
				/* ignore */
			}
			subj.emit({ state: 'error', progress: null, message: OVERSIZED_MESSAGE });
			clearTimeout(retry);
			retry = setTimeout(() => void open(), hostile.trip());
		};
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
			// Event-handler throws are uncaught exceptions (deep JSON can overflow the stack).
			try {
				handle(ev.data);
			} catch {
				/* hostile or malformed frame: ignore it */
			}
		};
		const handle = (data: unknown) => {
			if (typeof data !== 'string' || data.length > MAX_REMOTE_MESSAGE_BYTES) return tooBig();
			const m: unknown = JSON.parse(data);
			if (!isObj(m)) return;
			hostile.good();
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
